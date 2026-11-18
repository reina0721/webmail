"""Offline regression tests for dual-architecture release assembly and guards."""
import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_metadata", ROOT / "tooling/release_metadata.py")
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)
VERSION = (ROOT / "release-version.txt").read_text().strip()
COMMIT = "1" * 40


def archive(path, name, value):
    data = json.dumps(value).encode()
    with tarfile.open(path, "w:gz") as output:
        member = tarfile.TarInfo("./" + name)
        member.size = len(data)
        output.addfile(member, io.BytesIO(data))


class ReleasePackaging(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        for name in ("release-version.txt", "backend/Cargo.toml", "crates/mailwebctl/Cargo.toml", "install.sh", ".env.example", "tooling/release_metadata.py", "tooling/release-guard.sh", "tooling/release_status.py"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        self.output = self.root / "output"
        for arch in metadata.ARCHITECTURES:
            manifest = {"version": VERSION, "cliVersion": VERSION[1:], "architecture": f"linux/{arch}", "sourceCommit": COMMIT, "image": f"mail-web:{VERSION[1:]}", "imageId": "sha256:" + "a" * 64}
            (self.inputs / f"release-manifest-linux-{arch}.json").write_text(json.dumps(manifest))
            archive(self.inputs / f"mail-web-linux-{arch}.tar.gz", "release-manifest.json", manifest)
            archive(self.inputs / f"mailwebctl-linux-{arch}.tar.gz", "cli-manifest.json", {"version": VERSION, "architecture": f"linux/{arch}"})

    def assemble(self):
        with mock.patch.object(metadata.subprocess, "check_output", return_value=COMMIT + "\n"):
            metadata.assemble(self.root, self.inputs, self.output, VERSION)

    def test_complete_release_and_legacy_manifest(self):
        self.assemble()
        self.assertEqual((self.output / "release-manifest.json").read_bytes(), (self.output / "release-manifest-linux-amd64.json").read_bytes())
        entries = (self.output / "SHA256SUMS").read_text().splitlines()
        self.assertEqual(len(entries), 8)
        for entry in entries:
            checksum, name = entry.split()
            self.assertEqual(checksum, metadata.digest(self.output / name))
        subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=self.output, check=True, stdout=subprocess.DEVNULL)

    def test_version_sources_must_agree(self):
        for name in ("release-version.txt", "backend/Cargo.toml", "crates/mailwebctl/Cargo.toml", "install.sh", ".env.example"):
            path = self.root / name
            original = path.read_text()
            with self.subTest(name=name):
                path.write_text(original.replace(VERSION[1:], "99.0.0"))
                with self.assertRaises(ValueError):
                    metadata.version_check(self.root, VERSION)
                path.write_text(original)
        for version in ("v01.0.0", "v1.0.0-alpha.01", "v1.0.0-", "1.0.0", "v1.0.0+build"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                metadata.version_check(self.root, version)

    def test_manifest_platform_commit_version_and_cli_must_match(self):
        original = json.loads((self.inputs / "release-manifest-linux-arm64.json").read_text())
        for patch in ({"architecture": "linux/amd64"}, {"sourceCommit": "2" * 40}, {"version": "v99.0.0"}, {"cliVersion": "99.0.0"}, {"imageId": "invalid"}):
            with self.subTest(patch=patch):
                candidate = {**original, **patch}
                with self.assertRaises(ValueError):
                    metadata.validate_manifest(candidate, VERSION, "arm64", COMMIT)

    def test_archive_manifests_cannot_disagree(self):
        path = self.inputs / "mail-web-linux-arm64.tar.gz"
        archive(path, "release-manifest.json", {"version": "v99.0.0"})
        with self.assertRaises(ValueError):
            self.assemble()
        self.assertFalse(self.output.exists())

    def test_cli_manifest_mismatch(self):
        archive(self.inputs / "mailwebctl-linux-arm64.tar.gz", "cli-manifest.json", {"version": VERSION, "architecture": "linux/amd64"})
        with self.assertRaises(ValueError):
            self.assemble()

    def test_missing_architecture_does_not_create_partial_output(self):
        (self.inputs / "mail-web-linux-arm64.tar.gz").unlink()
        with self.assertRaises(FileNotFoundError):
            self.assemble()
        self.assertFalse(self.output.exists())

    def test_downloaded_attachments_require_complete_untampered_checksums(self):
        self.assemble()
        with mock.patch.object(metadata.subprocess, "check_output", return_value=COMMIT + "\n"):
            metadata.verify_assets(self.root, self.output, VERSION)
            package = self.output / "mailwebctl-linux-arm64.tar.gz"
            original = package.read_bytes()
            package.write_bytes(b"truncated")
            with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                metadata.verify_assets(self.root, self.output, VERSION)
            package.write_bytes(original)
            sums = self.output / "SHA256SUMS"
            original_sums = sums.read_text()
            sums.write_text(original_sums + original_sums.splitlines()[0] + "\n")
            with self.assertRaisesRegex(ValueError, "exactly once"):
                metadata.verify_assets(self.root, self.output, VERSION)
            sums.write_text(original_sums)
            (self.output / "unexpected.txt").write_text("unverified")
            with self.assertRaisesRegex(ValueError, "unexpected"):
                metadata.verify_assets(self.root, self.output, VERSION)

    def test_unknown_output_cannot_enter_checksums(self):
        self.output.mkdir()
        (self.output / "stale.tar.gz").write_bytes(b"old")
        with self.assertRaises(ValueError):
            self.assemble()

    def test_source_archive_contains_committed_docs_and_excludes_local_state(self):
        (self.root / "README_ZH.md").write_text("Committed documentation")
        (self.root / "untracked-runtime.sqlite").write_bytes(b"synthetic local state")
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "README_ZH.md", "release-version.txt"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=Release test", "-c", "user.email=release-test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "Source archive fixture"], cwd=self.root, check=True)
        source = self.root / "source.tar.gz"
        with source.open("wb") as output:
            subprocess.run(["git", "archive", "--format=tar.gz", "HEAD"], cwd=self.root, stdout=output, check=True)
        metadata.verify_source(self.root, source)
        with tarfile.open(source) as exported:
            self.assertIn("README_ZH.md", exported.getnames())
            self.assertNotIn("untracked-runtime.sqlite", exported.getnames())
        archive(source, "release-version.txt", VERSION)
        with self.assertRaises(ValueError):
            metadata.verify_source(self.root, source)

    def test_native_platform_and_standalone_bootstrap_names(self):
        fakebin = self.root / "fakebin"
        fakebin.mkdir()
        uname = fakebin / "uname"
        uname.write_text('#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_CPU";; esac\n')
        uname.chmod(0o755)
        for cpu, arch in (("x86_64", "amd64"), ("amd64", "amd64"), ("aarch64", "arm64"), ("arm64", "arm64")):
            with self.subTest(cpu=cpu):
                result = subprocess.check_output(["sh", ROOT / "tooling/platform.sh", "Linux", cpu], text=True).strip()
                self.assertEqual(result, arch)
                # Stop at the download, observing which asset the real bootstrap requests.
                curl = fakebin / "curl"
                requests = self.root / "requests"
                requests.unlink(missing_ok=True)
                # A separate SHA response lets execution reach the archive download.
                curl.write_text('#!/usr/bin/env python3\nimport os,pathlib,sys\na=sys.argv[1:]; out=pathlib.Path(a[a.index("-o")+1]); url=next(x for x in a if x.startswith("https://"));\nwith open(os.environ["TEST_REQUESTS"],"a") as log: log.write(url+"\\n")\nif url.endswith("SHA256SUMS"): out.write_text("0"*64+"  mailwebctl-linux-"+os.environ["TEST_ARCH"]+".tar.gz\\n")\nelse: sys.exit(42)\n')
                curl.chmod(0o755)
                env = {**os.environ, "PATH": str(fakebin) + os.pathsep + os.environ["PATH"], "TEST_OS": "Linux", "TEST_CPU": cpu, "TEST_ARCH": arch, "TEST_REQUESTS": str(requests)}
                env.pop("MAIL_WEB_BOOTSTRAP_DIR", None)
                result = subprocess.run(["bash", ROOT / "install.sh", "--yes"], env=env, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"mailwebctl-linux-{arch}.tar.gz", requests.read_text())
        self.assertNotEqual(subprocess.run(["sh", ROOT / "tooling/platform.sh", "Darwin", "arm64"], capture_output=True).returncode, 0)

    def test_release_guard_rejects_published_and_other_commits(self):
        fakebin = self.root / "fakebin"
        fakebin.mkdir()
        git = fakebin / "git"
        git.write_text('#!/bin/sh\ncase "$1" in rev-parse) echo "$TEST_COMMIT";; ls-remote) if [ -n "$TEST_TAG" ]; then printf "%s\\trefs/tags/test\\n" "$TEST_TAG"; fi; if [ -n "${TEST_PEELED:-}" ]; then printf "%s\\trefs/tags/test^{}\\n" "$TEST_PEELED"; fi;; esac\n')
        git.chmod(0o755)
        gh = fakebin / "gh"
        gh.write_text('#!/bin/sh\nif [ -n "${TEST_STATUS:-}" ]; then echo "HTTP $TEST_STATUS" >&2; exit 1; fi\ncat "$TEST_RELEASE"\n')
        gh.chmod(0o755)
        release = self.root / "release.json"
        env = {**os.environ, "PATH": str(fakebin) + os.pathsep + os.environ["PATH"], "TEST_COMMIT": COMMIT, "TEST_TAG": COMMIT, "TEST_RELEASE": str(release), "GITHUB_REF": "refs/tags/test"}
        def set_release(draft, commit):
            release.write_text(json.dumps([[{"tag_name": VERSION, "draft": draft, "target_commitish": commit}]]))

        for draft, commit, success in ((True, COMMIT, True), (False, COMMIT, False), (True, "2" * 40, False), (True, "main", True)):
            set_release(draft, commit)
            result = subprocess.run(["sh", self.root / "tooling/release-guard.sh", VERSION], env=env, capture_output=True)
            self.assertEqual(result.returncode == 0, success, result.stderr.decode())
        set_release(True, COMMIT)
        env["TEST_TAG"] = "3" * 40
        result = subprocess.run(["sh", self.root / "tooling/release-guard.sh", VERSION], env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        # Annotated tags must be compared using their peeled commit.
        env["TEST_PEELED"] = COMMIT
        result = subprocess.run(["sh", self.root / "tooling/release-guard.sh", VERSION], env=env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        env["TEST_TAG"] = ""
        env.pop("TEST_PEELED")
        release.write_text("[[]]")
        result = subprocess.run(["sh", self.root / "tooling/release-guard.sh", VERSION], env=env, capture_output=True)
        self.assertEqual(result.stdout.strip(), b"new")
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        for status in ("403", "404"):
            env["TEST_STATUS"] = status
            result = subprocess.run(["sh", self.root / "tooling/release-guard.sh", VERSION], env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()

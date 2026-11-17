#!/usr/bin/env python3
"""Validate version inputs and assemble one immutable, dual-architecture release."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import tarfile
import tomllib

ARCHITECTURES = ("amd64", "arm64")


def version_check(root, version):
    match = re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?", version)
    if not match or any(p.isdigit() and len(p) > 1 and p.startswith("0") for p in (match[4] or "").split(".")):
        raise ValueError("Expected a v-prefixed SemVer without build metadata")
    expected = version[1:]
    if (root / "release-version.txt").read_text().strip() != version:
        raise ValueError("release-version.txt does not match the requested version")
    for name in ("backend/Cargo.toml", "crates/mailwebctl/Cargo.toml"):
        if tomllib.loads((root / name).read_text())["package"]["version"] != expected:
            raise ValueError(f"{name} package version does not match {version}")
    bootstrap = re.search(r"^bootstrap_version=(\S+)$", (root / "install.sh").read_text(), re.M)
    if not bootstrap or bootstrap[1] != version:
        raise ValueError("install.sh bootstrap version does not match the release")
    if f"MAIL_WEB_VERSION={expected}" not in (root / ".env.example").read_text().splitlines():
        raise ValueError(".env.example version does not match the release")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def archive_json(path, name):
    # Streaming avoids storing a potentially large image archive in memory.
    with tarfile.open(path, "r|gz") as archive:
        for member in archive:
            if member.name.removeprefix("./") == name:
                if not member.isfile():
                    raise ValueError(f"Not a regular file: {name}")
                return json.load(archive.extractfile(member))
    raise ValueError(f"Missing {name} in {path.name}")


def validate_manifest(manifest, version, architecture, commit):
    if (manifest.get("version") != version
            or manifest.get("cliVersion") != version[1:]
            or manifest.get("architecture") != f"linux/{architecture}"
            or manifest.get("sourceCommit") != commit
            or manifest.get("image") != f"mail-web:{version[1:]}"
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", manifest.get("imageId", ""))):
        raise ValueError(f"Release manifest mismatch: {architecture}")


def verify_source(root, archive):
    tracked = set(filter(None, subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", "-z", "HEAD"], cwd=root
    ).decode().split("\0")))
    with tarfile.open(archive, "r|gz") as source:
        exported = {member.name for member in source if not member.isdir()}
    if exported != tracked:
        raise ValueError("Corresponding source must contain exactly the committed repository files")


def assemble(root, inputs, destination, version):
    version_check(root, version)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    files = []
    for arch in ARCHITECTURES:
        manifest_name = f"release-manifest-linux-{arch}.json"
        manifest = json.loads((inputs / manifest_name).read_text())
        validate_manifest(manifest, version, arch, commit)
        app = inputs / f"mail-web-linux-{arch}.tar.gz"
        cli = inputs / f"mailwebctl-linux-{arch}.tar.gz"
        if archive_json(app, "release-manifest.json") != manifest:
            raise ValueError(f"Application archive manifest mismatch: {arch}")
        if archive_json(cli, "cli-manifest.json") != {"version": version, "architecture": f"linux/{arch}"}:
            raise ValueError(f"CLI archive manifest mismatch: {arch}")
        files.extend([app, cli, inputs / manifest_name])
    destination.mkdir(parents=True, exist_ok=True)
    expected_names = {file.name for file in files} | {"install.sh", "release-manifest.json", "SHA256SUMS"}
    if any(file.name not in expected_names or not file.is_file() for file in destination.iterdir()):
        raise ValueError("Release output directory contains unexpected entries")
    for file in files:
        shutil.copyfile(file, destination / file.name)
    shutil.copyfile(root / "install.sh", destination / "install.sh")
    shutil.copyfile(destination / "release-manifest-linux-amd64.json", destination / "release-manifest.json")
    attachments = sorted(file for file in destination.iterdir() if file.name != "SHA256SUMS")
    (destination / "SHA256SUMS").write_text("".join(f"{digest(file)}  {file.name}\n" for file in attachments))


def verify_assets(root, inputs, version):
    version_check(root, version)
    expected = {"install.sh", "release-manifest.json"}
    for arch in ARCHITECTURES:
        expected.update({f"mail-web-linux-{arch}.tar.gz", f"mailwebctl-linux-{arch}.tar.gz", f"release-manifest-linux-{arch}.json"})
    if {path.name for path in inputs.iterdir()} != expected | {"SHA256SUMS"}:
        raise ValueError("Missing or unexpected draft attachments")
    entries = [line.split() for line in (inputs / "SHA256SUMS").read_text().splitlines()]
    if (any(len(entry) != 2 for entry in entries) or len(entries) != len(expected)
            or {entry[1] for entry in entries} != expected):
        raise ValueError("Checksums must cover every attachment exactly once")
    for checksum, name in entries:
        if checksum != digest(inputs / name):
            raise ValueError(f"Checksum mismatch: {name}")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    for arch in ARCHITECTURES:
        validate_manifest(json.loads((inputs / f"release-manifest-linux-{arch}.json").read_text()), version, arch, commit)
    if (inputs / "release-manifest.json").read_bytes() != (inputs / "release-manifest-linux-amd64.json").read_bytes():
        raise ValueError("Legacy manifest must match AMD64")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check-version", "assemble", "verify-assets", "verify-source"])
    parser.add_argument("version")
    parser.add_argument("--inputs", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[1]
    if args.command == "check-version":
        version_check(root, args.version)
    elif args.command == "assemble":
        if args.inputs is None or args.output is None:
            parser.error("assemble requires --inputs and --output")
        assemble(root, args.inputs, args.output, args.version)
    elif args.command == "verify-assets":
        if args.inputs is None:
            parser.error("verify-assets requires --inputs")
        verify_assets(root, args.inputs, args.version)
    else:
        if args.inputs is None:
            parser.error("verify-source requires --inputs ARCHIVE")
        version_check(root, args.version)
        verify_source(root, args.inputs)


if __name__ == "__main__":
    main()

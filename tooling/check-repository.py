#!/usr/bin/env python3
"""Check authored entry points and guides without rewriting historical evidence."""
import pathlib
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCUMENTS = ["README.md", "README_ZH.md", "CONTRIBUTING.md", "CHANGELOG.md", "SECURITY.md", ".github/PULL_REQUEST_TEMPLATE.md", "docs/deployment.md", "docs/releasing.md", "docs/cli.md", "docs/stalwart-setup.md", "examples/README.md"]
REQUIRED = DOCUMENTS + ["llms.txt", ".github/ISSUE_TEMPLATE/bug_report.yml", ".github/ISSUE_TEMPLATE/feature_request.yml", "examples/install-unattended.sh", "examples/infrastructure.env.example"]


def visible(text):
    return re.sub(r"^```[^\n]*\n.*?^```\s*$", "", text, flags=re.M | re.S)


def headings(path):
    text = visible(path.read_text())
    return {re.sub(r"[^\w -]", "", title.lower()).replace(" ", "-") for title in re.findall(r"^#{1,6}\s+(.+?)\s*$", text, re.M)} | set(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)["\']', text))


def check():
    errors = []
    for name in REQUIRED:
        if not (ROOT / name).is_file() or not (ROOT / name).stat().st_size:
            errors.append("Missing or empty: " + name)
    if errors:
        return errors
    for name in DOCUMENTS:
        source = ROOT / name
        for target in re.findall(r"!?\[[^\]\n]*\]\(([^)\n]+)\)", visible(source.read_text())):
            target = target.strip().strip("<>")
            parts = urllib.parse.urlsplit(target)
            if parts.scheme or parts.netloc:
                continue
            destination = source.parent / urllib.parse.unquote(parts.path) if parts.path else source
            if not destination.exists():
                errors.append(f"{name}: missing link target {target}")
            elif parts.fragment and destination.suffix == ".md" and urllib.parse.unquote(parts.fragment) not in headings(destination):
                errors.append(f"{name}: missing heading {target}")
    if (ROOT / "examples/infrastructure.env.example").read_bytes() != (ROOT / ".env.example").read_bytes():
        errors.append("Infrastructure example differs from .env.example")
    infrastructure = dict(line.split("=", 1) for line in (ROOT / ".env.example").read_text().splitlines() if line and not line.startswith("#"))
    for name in ("README.md", "README_ZH.md"):
        for block in re.findall(r"```dotenv\n(.*?)```", (ROOT / name).read_text(), re.S):
            for line in block.strip().splitlines():
                key, value = line.split("=", 1)
                if infrastructure.get(key) != value:
                    errors.append(f"{name}: infrastructure example mismatch for {key}")
    english = (ROOT / "README.md").read_text()
    chinese = (ROOT / "README_ZH.md").read_text()
    for language in ("bash", "dotenv"):
        pattern = rf"```{language}\n(.*?)```"
        if re.findall(pattern, english, re.S) != re.findall(pattern, chinese, re.S):
            errors.append(f"README {language} examples differ between languages")
    return errors


if __name__ == "__main__":
    errors = check()
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print("Repository entry points, local links and bilingual examples passed.")

#!/bin/sh
# Print the supported native release architecture. Explicit names are useful for QA.
set -eu
case "${1:-$(uname -s)}/${2:-$(uname -m)}" in
 Linux/x86_64|Linux/amd64|linux/x86_64|linux/amd64) echo amd64;;
 Linux/aarch64|Linux/arm64|linux/aarch64|linux/arm64) echo arm64;;
 *) echo 'Only Linux AMD64 / ARM64 is supported' >&2; exit 1;;
esac

#!/bin/sh
# Compatibility entry point; lifecycle implementation lives in Rust.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cli="$root/bin/mailwebctl"
test -x "$cli" || { echo 'Rust CLI missing. Run the current install.sh --dir PATH to migrate this installation.' >&2; exit 1; }
action=${1:-status}; if [ "$#" -gt 0 ]; then shift; fi
case "$action" in
 install|update) version=${1:-latest}; if [ "$#" -gt 0 ]; then shift; fi; exec "$cli" --dir "$root" --yes "$action" --version "$version" "$@";;
 restore) exec "$cli" --dir "$root" --yes restore "$@";;
 rotate-setup-token) exec "$cli" --dir "$root" rotate-setup-token "$@";;
 policy-verified) exec "$cli" --dir "$root" policy-verified "$@";;
 *) exec "$cli" --dir "$root" "$action" "$@";;
esac

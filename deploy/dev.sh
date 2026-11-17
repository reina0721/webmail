#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if ! docker info >/dev/null 2>&1; then exec sudo -n --preserve-env=MAIL_WEB_REVISION,MAIL_WEB_DEV_MAX_BODY_BYTES sh "$PWD/deploy/dev.sh" "$@"; fi
root="$PWD/tests/runtime/rebuild"
mkdir -p "$root"
if [ "${MAIL_WEB_TEST_DEPLOY_LOCK:-}" != 1 ]; then
 exec 9>"$root/lock"
 flock -n 9 || { echo 'A test deployment or regression owns this environment; wait for it to finish.' >&2; exit 1; }
 export MAIL_WEB_TEST_DEPLOY_LOCK=1
fi
case "${1:-up}" in
 up)
  if [ ! -s "$root/compose.env" ]; then python3 tooling/test-environment.py prepare "$root"; fi
  python3 tooling/test-environment.py network "$root"
  docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml -f deploy/compose.dev.yaml up -d --wait --wait-timeout 180
  python3 tooling/test-environment.py bootstrap "$root"
  echo 'Live frontend uses the same Webmail address shown above. Source edits reload automatically.'
  ;;
 down)
  docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml -f deploy/compose.dev.yaml stop web
  docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml -f deploy/compose.dev.yaml rm -f web
  exec sh deploy/test-env.sh up
  ;;
 logs) docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml -f deploy/compose.dev.yaml logs --tail 80 web;;
 *) echo 'Usage: sh deploy/dev.sh up | down | logs' >&2; exit 1;;
esac

#!/bin/sh
# A self-contained, explicitly disposable local deployment. Never selects production containers.
set -eu
cd "$(dirname "$0")/.."
if ! docker info >/dev/null 2>&1; then
 if command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then exec sudo -n --preserve-env=MAIL_WEB_REVISION sh "$PWD/deploy/test-env.sh" "$@"; fi
 echo 'Docker Engine access is required.' >&2; exit 1
fi
for command in python3 openssl flock; do command -v "$command" >/dev/null || { echo "Missing dependency: $command" >&2; exit 1; }; done
architecture=$(sh tooling/platform.sh)
root="$PWD/tests/runtime/rebuild"
mkdir -p "$root"
if [ "${MAIL_WEB_TEST_DEPLOY_LOCK:-}" != 1 ]; then
 exec 9>"$root/lock"
 flock -n 9 || { echo 'A test deployment or regression owns this environment; wait for it to finish.' >&2; exit 1; }
 export MAIL_WEB_TEST_DEPLOY_LOCK=1
fi
if [ ! -s "$root/compose.env" ]; then
 python3 tooling/test-environment.py prepare "$root"
fi
compose(){ docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml "$@"; }
verify_stack(){
 docker build --platform "linux/$architecture" --target quality --build-arg MAIL_WEB_REVISION="${MAIL_WEB_REVISION:-$(git describe --always --dirty)}" -t mail-web-quality:rebuild .
 python3 tests/release-acceptance.py
 if docker ps -q --filter label=com.docker.compose.project=mailweb-rebuild --filter label=com.docker.compose.service=web | grep -q .; then echo 'Use deploy/test-env.sh up to switch from hot development to the production test build.' >&2;return 1;fi
 python3 tooling/run-test-actor.py
 python3 tooling/run-test-actor.py --native
 python3 tooling/run-test-actor.py --pim
 python3 tooling/run-test-actor.py --gateway
 python3 tooling/run-test-actor.py --push
 python3 tooling/verify-legacy.py
 python3 tooling/verify-backup-restore.py
 python3 tooling/run-test-actor.py --soak
 python3 tooling/check-release.py
}
action=${1:-up}; if [ "$#" -gt 0 ]; then shift; fi
case "$action" in
 up)
  python3 tooling/test-environment.py network "$root"
  build=false; verify=false
  for arg in "$@"; do case "$arg" in --build) build=true;; --verify) verify=true;; *) echo "Unknown option: $arg" >&2;exit 1;; esac;done
  if [ "$build" = true ] || ! docker image inspect mail-web:rebuild >/dev/null 2>&1; then docker build --platform "linux/$architecture" --build-arg MAIL_WEB_REVISION="${MAIL_WEB_REVISION:-$(git describe --always --dirty)}" -t mail-web:rebuild .; fi
  if docker ps -aq --filter label=com.docker.compose.project=mailweb-rebuild --filter label=com.docker.compose.service=web | grep -q .; then
   docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml -f deploy/compose.dev.yaml stop web
   docker compose --project-name mailweb-rebuild --env-file "$root/compose.env" -f deploy/compose.test.yaml -f deploy/compose.dev.yaml rm -f web
  fi
  compose up -d --wait --wait-timeout 180
  python3 tooling/test-environment.py bootstrap "$root"
  if [ "$verify" = true ]; then verify_stack; fi
  python3 tooling/test-environment.py status "$root"
  ;;
 status) compose ps;python3 tooling/test-environment.py status "$root";;
 verify) verify_stack;;
 logs) compose logs --tail 100; tail -n 100 "$root"/app/logs/*.log 2>/dev/null || true;;
 down) compose down;;
 *) echo 'Usage: sh deploy/test-env.sh up [--build] [--verify] | status | verify | logs | down' >&2;exit 1;;
esac

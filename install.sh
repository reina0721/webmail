#!/usr/bin/env bash
# Thin release bootstrap. TTY, checksum and mirror structure adapted from
# reina0721/dsh-docker@86a6e10 (MIT OR Apache-2.0); see docs/upstream/dsh.
set -Eeuo pipefail
umask 077
bootstrap_version=v0.4.0-alpha.2
repository=${MAIL_WEB_REPOSITORY:-reina0721/webmail}
mirror=
repo_explicit=0
args=("$@")
for ((i=0;i<${#args[@]};i++)); do
 case "${args[i]}" in
  --repository) ((i+1<${#args[@]})) || { echo '缺少仓库参数' >&2; exit 1; }; repository=${args[i+1]}; repo_explicit=1;;
  --download-mirror) ((i+1<${#args[@]})) || { echo '缺少下载代理参数' >&2; exit 1; }; mirror=${args[i+1]};;
  --help|-h) echo 'Mail Web 一键安装：--dir PATH --container-name NAME --bind IP --port PORT --public-origin URL --allow-http --version latest|vVERSION --channel latest|stable --repository OWNER/REPO --download-mirror HTTPS_URL --yes';exit 0;;
 esac
done
if [[ $repo_explicit == 0 ]]; then args+=(--repository "$repository"); fi
case "$repository" in *[!a-zA-Z0-9_./-]*|/*|*..*|*/*/*) echo '仓库必须是 OWNER/REPO' >&2;exit 1;; */*) ;; *) exit 1;; esac
[[ $(uname -s)/$(uname -m) == Linux/x86_64 ]] || { echo '当前发布仅支持 Linux AMD64' >&2; exit 1; }
for tool in curl tar; do command -v "$tool" >/dev/null || { echo "缺少 $tool" >&2; exit 1; }; done
if command -v sha256sum >/dev/null; then sha=(sha256sum); elif command -v shasum >/dev/null; then sha=(shasum -a 256); else echo '缺少 SHA-256 工具' >&2;exit 1;fi
if [[ -n $mirror ]]; then [[ $mirror == https://* && $mirror != *'@'* && $mirror != *'?'* && $mirror != *'#'* ]] || { echo '下载代理必须是无凭据 HTTPS 地址' >&2;exit 1; };fi
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
asset=mailwebctl-linux-amd64.tar.gz
base="https://github.com/$repository/releases/download/$bootstrap_version"
fetch() {
 local url=$1 destination=$2
 if [[ -n ${MAIL_WEB_BOOTSTRAP_DIR:-} ]]; then
  # Offline/draft artifact acceptance. Native CLI still verifies the app bundle.
  cp "$MAIL_WEB_BOOTSTRAP_DIR/${url##*/}" "$destination"
  return
 fi
 if [[ -n $mirror ]]; then
  if curl -fL --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 15 --max-time 600 "${mirror%/}/$url" -o "$destination.part"; then mv "$destination.part" "$destination";return;fi
 fi
 curl -fL --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 15 --max-time 600 "$url" -o "$destination.part"
 mv "$destination.part" "$destination"
}
fetch "$base/SHA256SUMS" "$stage/SHA256SUMS"
fetch "$base/$asset" "$stage/$asset"
mapfile -t expected < <(awk -v name="$asset" '$2==name {print $1}' "$stage/SHA256SUMS")
[[ ${#expected[@]} == 1 && ${expected[0]} =~ ^[[:xdigit:]]{64}$ ]] || { echo '校验清单无效' >&2;exit 1; }
actual=$("${sha[@]}" "$stage/$asset");actual=${actual%% *}
[[ $actual == "${expected[0]}" ]] || { echo 'CLI SHA-256 校验失败' >&2;exit 1; }
tar -tzf "$stage/$asset" | awk '/^\// || /(^|\/)\.\.($|\/)/ {bad=1} END {exit bad}'
tar -tvzf "$stage/$asset" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}'
mkdir "$stage/unpack"
tar -xzf "$stage/$asset" -C "$stage/unpack" --no-same-owner --no-same-permissions
chmod 700 "$stage/unpack/bin/mailwebctl"
[[ $("$stage/unpack/bin/mailwebctl" --version) == "mailwebctl ${bootstrap_version#v}" ]] || { echo 'CLI 版本与引导版本不一致' >&2;exit 1; }
"$stage/unpack/bin/mailwebctl" install "${args[@]}"

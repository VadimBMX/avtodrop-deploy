#!/usr/bin/env bash
# Зібрати ОДИН файл migration/cmd.sh для старого шляху tools/gcp-run.cmd (ПК власника → ssh "bash -s").
# Файл самодостатній: усередині base64-архів ops/ і запуск setup-ops.sh з параметрами. upload.txt не потрібен.
#   ops/make-bundle.sh --repo git@github.com:OWNER/REPO.git [--status-repo git@github.com:OWNER/REPO2.git]
#                      [--bucket NAME] [--no-staging] [--out migration/cmd.sh]
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."
REPO="" STATUS="" BUCKET="" STG=1 OUT=migration/cmd.sh
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift 2;;
    --status-repo) STATUS=$2; shift 2;;
    --bucket) BUCKET=$2; shift 2;;
    --no-staging) STG=0; shift;;
    --out) OUT=$2; shift 2;;
    *) echo "невідомий параметр $1"; exit 1;;
  esac
done
re='^[A-Za-z0-9@:/._-]*$'
for v in "$REPO" "$STATUS" "$BUCKET"; do [[ "$v" =~ $re ]] || { echo "недопустимі символи: $v"; exit 1; }; done
mkdir -p "$(dirname "$OUT")"
B64=$(tar -czf - --owner=0 --group=0 --exclude=test --exclude='*.md' ops | base64 -w 76)
{
  cat <<HDR
#!/usr/bin/env bash
# АВТОДРОП: одноразове встановлення ops (згенеровано ops/make-bundle.sh $(date -u +%Y-%m-%dT%H:%MZ), коміт $(git rev-parse --short HEAD 2>/dev/null || echo '?'))
# Запуск: tools\\gcp-run.cmd на ПК власника. Безпечно запускати повторно.
set -euo pipefail
W=\$(mktemp -d /tmp/avtodrop-ops-setup.XXXXXX)
base64 -d > "\$W/ops.tgz" <<'B64END'
HDR
  printf '%s\n' "$B64"
  cat <<TAIL
B64END
tar -xzf "\$W/ops.tgz" -C "\$W"
sudo env DEPLOY_REPO='$REPO' STATUS_REPO='$STATUS' GCS_BUCKET='$BUCKET' STAGING='$STG' bash "\$W/ops/setup-ops.sh" </dev/null && rc=0 || rc=\$?
rm -rf "\$W"
exit \$rc
TAIL
} > "$OUT"
echo "OK: $OUT ($(wc -c < "$OUT") байт). Далі: власник запускає tools\\gcp-run.cmd, результат — migration\\run-log.txt"

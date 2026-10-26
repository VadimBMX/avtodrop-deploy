#!/usr/bin/env bash
# АВТОДРОП ops: ОДНОРАЗОВЕ встановлення (можна запускати повторно — нічого не зламає).
#   sudo DEPLOY_REPO=git@github.com:<owner>/<repo>.git [GCS_BUCKET=...] [STATUS_REPO=...] [STAGING=1] \
#        [STAGING_BOT_TOKEN=...] [NOTIFY_IDS=...] bash setup-ops.sh
# Ставить: pull-деплой (таймер кожні 2 хв, релізи + symlink, автовідкат), щоденний бекап (локально / GCS),
# сторож /healthz, logrotate, staging (порт 3200, окремий користувач і база) + Caddy для staging.<host>.
# Нічого не читає зі stdin (запускається через ssh "bash -s"). Секрети не друкує.
set -euo pipefail
R=${SETUP_ROOT:-}                       # для локального тесту: префікс замість /
SRC=$(dirname "$(readlink -f "$0")")
say() { printf '== %s\n' "$*"; }
warn() { printf '!! %s\n' "$*"; }
die() { printf 'ПОМИЛКА: %s\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "запусти через sudo"
for v in DEPLOY_REPO GCS_BUCKET STATUS_REPO NOTIFY_IDS STAGING_BOT_TOKEN; do
  case "${!v:-}" in *"'"*|*'"'*|*' '*|*'$'*|*'`'*|*'\'*) die "недопустимі символи в $v";; esac
done
STAGING=${STAGING:-1}

LIB=$R/usr/local/lib/avtodrop-ops
CONF=$R/etc/avtodrop-ops
PROD_ENV=$R/etc/avtodrop.env
STG_ENV=$R/etc/avtodrop-staging.env
SYSD=$R/etc/systemd/system
STATE_ROOT=/var/lib/avtodrop-ops
BACKUP_ROOT=/var/backups/avtodrop
APP_USER=avtodrop
STG_USER=avtodrop-stg
TS=$(date -u +%Y%m%d-%H%M%S)
rand() { node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64").replace(/[^A-Za-z0-9]/g,"").slice(0,+process.argv[1]))' "$1"; }

say "Перевірка пакетів"
missing=""
for c in git curl flock runuser ssh-keygen gzip; do command -v "$c" >/dev/null || missing="$missing $c"; done
if [ -n "$missing" ]; then
  say "доставляю:$missing"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq </dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl util-linux openssh-client gzip >/dev/null </dev/null
fi
NODE=$(command -v node) || die "немає node"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "потрібен Node 22+"
id -u "$APP_USER" >/dev/null 2>&1 || die "немає користувача $APP_USER — спершу tools/gcp/setup.sh"

say "Скрипти → /usr/local/lib/avtodrop-ops"
install -d -m 755 "$LIB/bin" "$LIB/lib" "$R/usr/local/bin"
install -m 755 "$SRC"/bin/* "$LIB/bin/"
install -m 644 "$SRC/lib/common.sh" "$LIB/lib/common.sh"
for b in avtodrop-deploy avtodrop-rollback avtodrop-ops avtodrop-staging-refresh avtodrop-backup avtodrop-watchdog; do
  ln -sfn "/usr/local/lib/avtodrop-ops/bin/$b" "$R/usr/local/bin/$b"
done

# ---- адреса ----
HOST=$(grep -m1 '^WEBAPP_URL=' "$PROD_ENV" 2>/dev/null | cut -d= -f2- | sed -E 's#^https?://##; s#/.*$##' || true)
if [ -z "$HOST" ]; then
  IP=$(curl -s -m 5 -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)
  [ -n "$IP" ] || die "не знаю адресу (немає WEBAPP_URL у /etc/avtodrop.env)"
  HOST="${IP//./-}.sslip.io"
fi
STG_HOST="staging.$HOST"
say "Прод: https://$HOST   Staging: https://$STG_HOST"

# ---- конфіг ----
install -d -m 700 "$CONF"
conf_set() { # FILE KEY VALUE — замінити/додати (порожнє VALUE = не чіпати)
  local f=$1 k=$2 v=$3
  [ -n "$v" ] || return 0
  touch "$f"
  if grep -q "^$k=" "$f"; then sed -i "s#^$k=.*#$k='$v'#" "$f"; else printf "%s='%s'\n" "$k" "$v" >> "$f"; fi
}
OPSC="$CONF/ops.conf"
[ -f "$OPSC" ] || cat > "$OPSC" <<'EOF'
# Налаштування ops АВТОДРОП. Після змін нічого перезапускати не треба — скрипти читають файл щоразу.
# DEPLOY_REPO   — репозиторій, з якого VM тягне код (гілки deploy і staging), доступ — deploy key (лише читання)
# STATUS_REPO   — (необов'язково) репозиторій для статусів деплою, ключ status_key з правом запису
# GCS_BUCKET    — (необов'язково) бакет Cloud Storage для щоденних бекапів
# NOTIFY_IDS    — кому слати повідомлення (за замовчуванням ADMIN_IDS з /etc/avtodrop.env)
EOF
conf_set "$OPSC" DEPLOY_REPO "${DEPLOY_REPO:-}"
conf_set "$OPSC" STATUS_REPO "${STATUS_REPO:-}"
conf_set "$OPSC" GCS_BUCKET "${GCS_BUCKET:-}"
conf_set "$OPSC" NOTIFY_IDS "${NOTIFY_IDS:-}"
chmod 600 "$OPSC"

cat > "$CONF/prod.conf" <<EOF
# згенеровано setup-ops.sh ($TS) — перезаписується при повторному запуску
SERVICE=avtodrop
BRANCH=deploy
PORT=3100
SANITY_PORT=3190
APP_LINK=/opt/avtodrop
RELEASES_DIR=/opt/avtodrop-releases
DATA_DIR=/data
ENV_FILE=/etc/avtodrop.env
RUN_USER=$APP_USER
LOG_FILE=/var/log/avtodrop.log
PUBLIC_URL=https://$HOST
EOF
cat > "$CONF/staging.conf" <<EOF
# згенеровано setup-ops.sh ($TS)
SERVICE=avtodrop-staging
BRANCH=staging
PORT=3200
SANITY_PORT=3290
APP_LINK=/opt/avtodrop-staging
RELEASES_DIR=/opt/avtodrop-staging-releases
DATA_DIR=/data-staging
ENV_FILE=/etc/avtodrop-staging.env
RUN_USER=$STG_USER
LOG_FILE=/var/log/avtodrop-staging.log
PUBLIC_URL=https://$STG_HOST
EOF
chmod 600 "$CONF/prod.conf" "$CONF/staging.conf"

# ---- ключі GitHub ----
# Ключ хоста github.com (опублікований GitHub; відбиток SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU)
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$CONF/known_hosts"
chmod 644 "$CONF/known_hosts"
for k in deploy_key status_key; do
  [ -f "$CONF/$k" ] || ssh-keygen -q -t ed25519 -N "" -C "avtodrop-vm-${k%_key}-$HOST" -f "$CONF/$k" </dev/null
  chmod 600 "$CONF/$k"; chmod 644 "$CONF/$k.pub"
done

# ---- користувачі й папки ----
if [ "$STAGING" = 1 ] && ! id -u "$STG_USER" >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin -d /nonexistent -M "$STG_USER"
fi
install -d -m 755 "$R$STATE_ROOT" "$R$STATE_ROOT/public"
install -d -m 711 "$R$BACKUP_ROOT"
install -d -m 700 "$R$BACKUP_ROOT/predeploy-prod" "$R$BACKUP_ROOT/predeploy-staging" "$R$BACKUP_ROOT/daily" "$R$BACKUP_ROOT/weekly"
install -d -m 700 -o "$APP_USER" "$R$BACKUP_ROOT/tmp-prod"
[ "$STAGING" = 1 ] && install -d -m 700 -o "$STG_USER" "$R$BACKUP_ROOT/tmp-staging" && install -d -m 750 -o "$STG_USER" "$R/data-staging"
touch "$R/var/log/avtodrop-ops.log"; chmod 640 "$R/var/log/avtodrop-ops.log"
touch "$R/var/log/avtodrop-staging.log"; [ "$STAGING" = 1 ] && chown "$STG_USER" "$R/var/log/avtodrop-staging.log"

# ---- /opt/avtodrop → releases/ + symlink ----
MIGRATED=0
install -d -m 755 "$R/opt/avtodrop-releases"
if [ -d "$R/opt/avtodrop" ] && [ ! -L "$R/opt/avtodrop" ]; then
  INIT="initial-$TS"
  say "Переношу /opt/avtodrop → /opt/avtodrop-releases/$INIT (symlink)"
  mv -T "$R/opt/avtodrop" "$R/opt/avtodrop-releases/$INIT"
  ln -sfn "/opt/avtodrop-releases/$INIT" "$R/opt/avtodrop"
  install -d -m 700 "$R$STATE_ROOT/prod"
  printf '%s' "$INIT" > "$R$STATE_ROOT/prod/current_release"
  MIGRATED=1
fi
[ -L "$R/opt/avtodrop" ] || die "/opt/avtodrop не існує — гра ще не встановлена"

# ---- systemd: прод (drop-in, основний unit не чіпаємо) ----
install -d -m 755 "$SYSD/avtodrop.service.d"
cat > "$SYSD/avtodrop.service.d/ops.conf" <<'EOF'
# АВТОДРОП ops: завжди піднімати гру знову, без ліміту перезапусків
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=3
EOF
install -m 644 "$SRC"/systemd/avtodrop-*.service "$SRC"/systemd/avtodrop-*.timer "$SYSD/"

# ---- staging ----
if [ "$STAGING" = 1 ]; then
  if [ ! -f "$STG_ENV" ]; then
    ( umask 077
      printf 'BOT_TOKEN=\nADMIN_IDS=%s\nADMIN_KEY=%s\nWEBAPP_URL=https://%s\n' \
        "$(grep -m1 '^ADMIN_IDS=' "$PROD_ENV" 2>/dev/null | cut -d= -f2-)" "$(rand 40)" "$STG_HOST" > "$STG_ENV" )
  fi
  if [ -n "${STAGING_BOT_TOKEN:-}" ]; then
    [ "$STAGING_BOT_TOKEN" != "$(grep -m1 '^BOT_TOKEN=' "$PROD_ENV" | cut -d= -f2-)" ] || die "STAGING_BOT_TOKEN збігається з токеном проду — потрібен ОКРЕМИЙ тестовий бот"
    sed -i "s#^BOT_TOKEN=.*#BOT_TOKEN=$STAGING_BOT_TOKEN#" "$STG_ENV"
  fi
  chmod 600 "$STG_ENV"
  cat > "$SYSD/avtodrop-staging.service" <<EOF
[Unit]
Description=AVTODROP staging (port 3200, own DB, no prod bot)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
User=$STG_USER
WorkingDirectory=/opt/avtodrop-staging
EnvironmentFile=/etc/avtodrop-staging.env
Environment=NODE_ENV=production DATA_DIR=/data-staging PORT=3200
ExecStart=$NODE server.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/avtodrop-staging.log
StandardError=append:/var/log/avtodrop-staging.log
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
InaccessiblePaths=-/data -/etc/avtodrop.env -/etc/avtodrop-ops -/var/backups/avtodrop
MemoryMax=350M

[Install]
WantedBy=multi-user.target
EOF
  install -d -m 755 "$R/opt/avtodrop-staging-releases"
  if [ ! -e "$R/opt/avtodrop-staging" ]; then
    SI="initial-copy-$TS"
    cp -a "$R$(readlink "$R/opt/avtodrop")" "$R/opt/avtodrop-staging-releases/$SI"
    ln -sfn "/opt/avtodrop-staging-releases/$SI" "$R/opt/avtodrop-staging"
    install -d -m 700 "$R$STATE_ROOT/staging"; printf '%s' "$SI" > "$R$STATE_ROOT/staging/current_release"
  fi
  # пароль для staging (лише якщо немає тестового бота: тоді staging у DEV-режимі й закривається логіном)
  [ -f "$CONF/staging-pass" ] || { ( umask 077; rand 20 > "$CONF/staging-pass" ); NEW_STG_PASS=1; }
fi

# ---- logrotate ----
LOGGRP=$(stat -c %G "$R/var/log" 2>/dev/null || echo root)
install -d -m 755 "$R/etc/logrotate.d"
cat > "$R/etc/logrotate.d/avtodrop" <<EOF
/var/log/avtodrop.log /var/log/avtodrop-staging.log /var/log/avtodrop-ops.log {
	su root $LOGGRP
	daily
	maxsize 50M
	rotate 14
	missingok
	notifempty
	compress
	delaycompress
	copytruncate
}
EOF

# ---- Caddy ----
CF=$R/etc/caddy/Caddyfile
STG_BLOCK=""
if [ "$STAGING" = 1 ]; then
  if [ -z "$(grep -m1 '^BOT_TOKEN=' "$STG_ENV" | cut -d= -f2-)" ]; then
    PASS=$(cat "$CONF/staging-pass")
    HASH=$(printf '%s\n' "$PASS" | caddy hash-password 2>/dev/null | tail -1 || true)
    case "$HASH" in '$2'*) ;; *) HASH=$(caddy hash-password --plaintext "$PASS" | tail -1);; esac
    STG_AUTH=$(printf '\tbasicauth {\n\t\ttester %s\n\t}\n' "$HASH")
  else
    STG_AUTH=""   # тестовий бот: вхід через Telegram, DEV вимкнено
  fi
  STG_BLOCK=$(printf '\n%s {\n%s\n\tencode gzip\n\treverse_proxy 127.0.0.1:3200\n}\n' "$STG_HOST" "$STG_AUTH")
fi
cat > "$CF.ops-new" <<EOF
# згенеровано setup-ops.sh ($TS); попередній — Caddyfile.bak-*
$HOST {
	handle_path /_ops/* {
		root * $STATE_ROOT/public
		header Cache-Control "no-store"
		file_server
	}
	handle {
		reverse_proxy 127.0.0.1:3100
	}
}
$STG_BLOCK
EOF
if [ -f "$CF" ] && cmp -s <(grep -v '^# згенеровано' "$CF") <(grep -v '^# згенеровано' "$CF.ops-new"); then
  rm -f "$CF.ops-new"; CADDY_CHANGED=0
elif caddy validate --adapter caddyfile --config "$CF.ops-new" >/dev/null 2>&1; then
  [ -f "$CF" ] && cp -p "$CF" "$CF.bak-$TS"
  mv -f "$CF.ops-new" "$CF"; chmod 644 "$CF"; CADDY_CHANGED=1
else
  warn "новий Caddyfile не пройшов перевірку — лишаю старий ($CF.ops-new для діагностики)"; CADDY_CHANGED=0
fi

# ---- застосувати ----
say "systemd daemon-reload + таймери"
systemctl daemon-reload
systemctl enable -q --now avtodrop-deploy@prod.timer avtodrop-watchdog.timer avtodrop-backup.timer
[ "$CADDY_CHANGED" = 1 ] && { systemctl reload caddy || systemctl restart caddy; }

health() { for _ in $(seq 1 "$2"); do [ "$(curl -fsS -m 3 "http://127.0.0.1:$1/healthz" 2>/dev/null)" = ok ] && return 0; sleep 1; done; return 1; }
if [ "$MIGRATED" = 1 ]; then
  say "Перезапуск гри через новий symlink (перевірка)"
  systemctl restart avtodrop
  if health 3100 45; then echo "гра: ok"; else
    warn "гра не піднялась через symlink — повертаю звичайну папку"
    rm -f "$R/opt/avtodrop"; mv -T "$R/opt/avtodrop-releases/$INIT" "$R/opt/avtodrop"; systemctl restart avtodrop
    die "міграцію скасовано, гра на старому місці. Лог: tail -50 /var/log/avtodrop.log"
  fi
elif ! systemctl is-active -q avtodrop; then
  systemctl restart avtodrop
fi

if [ "$STAGING" = 1 ]; then
  [ -s "$R/data-staging/avtodrop.db" ] || { say "Staging: копія бази проду"; "$LIB/bin/avtodrop-staging-refresh" --no-start || warn "не вдалося скопіювати базу в staging"; }
  systemctl enable -q avtodrop-staging avtodrop-deploy@staging.timer
  systemctl restart avtodrop-staging; systemctl start avtodrop-deploy@staging.timer
  health 3200 45 && echo "staging: ok" || warn "staging не піднявся: tail -30 /var/log/avtodrop-staging.log"
else
  systemctl disable -q --now avtodrop-deploy@staging.timer avtodrop-staging 2>/dev/null || true
fi
systemctl start avtodrop-watchdog.service || true

# ---- доступ до GitHub ----
# shellcheck source=/dev/null
. "$OPSC"
ACCESS="не задано DEPLOY_REPO"
if [ -n "${DEPLOY_REPO:-}" ]; then
  if GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -i $CONF/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=$CONF/known_hosts -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 -o BatchMode=yes -o ConnectTimeout=15" \
     timeout 40 git ls-remote "$DEPLOY_REPO" >/dev/null 2>&1; then ACCESS="є (VM бачить $DEPLOY_REPO)"; else ACCESS="НЕМАЄ — додай ключ нижче в GitHub (Deploy keys)"; fi
fi
KEYS_URL=""
case "${DEPLOY_REPO:-}" in git@github.com:*) r=${DEPLOY_REPO#git@github.com:}; KEYS_URL="https://github.com/${r%.git}/settings/keys/new";; esac
DKEY=$(cat "$CONF/deploy_key.pub")

echo
echo "==================== ГОТОВО ===================="
echo "Доступ VM до репозиторію деплою: $ACCESS"
echo "Ключ VM (публічний, його можна показувати) — додати в GitHub → репозиторій → Settings → Deploy keys → Add deploy key"
[ -n "$KEYS_URL" ] && echo "  $KEYS_URL"
echo "  Title: avtodrop-vm    Key:"
echo "$DKEY"
echo "  «Allow write access» НЕ ставити."
if [ -n "${STATUS_REPO:-}" ]; then
  echo "Ключ для статусів (репозиторій $STATUS_REPO, ТУТ «Allow write access» поставити):"
  cat "$CONF/status_key.pub"
fi
echo "Прод: https://$HOST     Статус деплою: https://$HOST/_ops/prod.json"
[ "$STAGING" = 1 ] && echo "Staging: https://$STG_HOST  (логін tester, пароль надіслано ботом; на сервері: sudo cat $CONF/staging-pass)"
echo "Команди: avtodrop-ops status | sudo avtodrop-rollback | sudo avtodrop-backup | sudo avtodrop-staging-refresh"

# Повідомлення власнику ботом: ключ (публічний) і пароль staging (лише при створенні, у лог не пишеться)
# shellcheck source=lib/common.sh
OPS_CONF_DIR=$CONF; export OPS_CONF_DIR; . "$LIB/lib/common.sh"; load_global 2>/dev/null || true; export INSTANCE=setup
MSG="Ops встановлено. Доступ до репозиторію деплою: $ACCESS."
[ -n "$KEYS_URL" ] && [[ "$ACCESS" != є* ]] && MSG="$MSG
1) Відкрий $KEYS_URL
2) Title: avtodrop-vm, Key — рядок нижче, «Allow write access» НЕ ставити, Add key.
$DKEY"
[ "${NEW_STG_PASS:-0}" = 1 ] && [ "$STAGING" = 1 ] && MSG="$MSG
Staging: https://$STG_HOST логін tester, пароль $(cat "$CONF/staging-pass")"
notify "$MSG" >/dev/null 2>&1 || true

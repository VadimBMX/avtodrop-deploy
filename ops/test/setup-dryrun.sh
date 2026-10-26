#!/usr/bin/env bash
# Сухий прогін setup-ops.sh у тимчасовому корені (SETUP_ROOT) із заглушками systemctl/caddy/ssh-keygen/curl.
# Перевіряє: файли на місці, /opt/avtodrop перенесено в releases/ + symlink, повторний запуск нічого не ламає,
# секрети не потрапляють у вивід.   bash ops/test/setup-dryrun.sh [TMPDIR]
set -uo pipefail
OPS=$(cd "$(dirname "$0")/.." && pwd)
T=${1:-$(mktemp -d)}; rm -rf "$T"; mkdir -p "$T/root" "$T/bin"
R=$T/root
mkdir -p "$R/etc/caddy" "$R/opt/avtodrop/public" "$R/data" "$R/var/log" "$R/etc/systemd/system"
echo 'console.log(1)' > "$R/opt/avtodrop/server.js"
printf 'BOT_TOKEN=111111111:AAsecretsecretsecretsecretsecretsec\nADMIN_IDS=42\nADMIN_KEY=supersecretadminkey123456\nWEBAPP_URL=https://136-71-1-110.sslip.io\n' > "$R/etc/avtodrop.env"
printf '136-71-1-110.sslip.io {\n\treverse_proxy 127.0.0.1:3100\n}\n' > "$R/etc/caddy/Caddyfile"
cat > "$T/bin/systemctl" <<S
#!/bin/sh
echo "systemctl \$*" >> "$T/calls.log"; exit 0
S
cat > "$T/bin/caddy" <<'S'
#!/bin/sh
case "$1" in validate) exit 0;; hash-password) read -r _; echo '$2a$14$FAKEHASHFAKEHASHFAKEHASH';; esac
S
cat > "$T/bin/ssh-keygen" <<'S'
#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = -f ] && f=$2; shift; done
echo "PRIVATE" > "$f"; echo "ssh-ed25519 AAAAFAKEPUBLICKEY avtodrop-vm" > "$f.pub"
S
cat > "$T/bin/curl" <<'S'
#!/bin/sh
for a; do case "$a" in *127.0.0.1:3100/healthz*|*127.0.0.1:3200/healthz*) echo ok; exit 0;; esac; done
exit 7
S
cat > "$T/bin/useradd" <<S
#!/bin/sh
echo "useradd \$*" >> "$T/calls.log"
S
cat > "$T/bin/id" <<'S'
#!/bin/sh
[ "$1" = -u ] && [ -n "$2" ] && { case "$2" in avtodrop|avtodrop-stg) echo 999; exit 0;; esac; }
exec /usr/bin/id "$@"
S
cat > "$T/bin/install" <<'S'
#!/bin/sh
# як справжній install, але без -o (користувачів у пісочниці немає)
args=""; skip=0
for a; do if [ $skip = 1 ]; then skip=0; continue; fi; [ "$a" = -o ] && { skip=1; continue; }; args="$args '$a'"; done
eval exec /usr/bin/install $args
S
cat > "$T/bin/chown" <<'S'
#!/bin/sh
exit 0
S
chmod +x "$T/bin"/*
export PATH="$T/bin:$PATH" SETUP_ROOT=$R OPS_NOTIFY_CMD="tee -a $T/notify.log" OPS_CONF_DIR=$R/etc/avtodrop-ops
PASS=0; FAIL=0
check() { local d=$1; shift; if "$@"; then echo "  ✓ $d"; PASS=$((PASS + 1)); else echo "  ✗ $d"; FAIL=$((FAIL + 1)); fi; }

echo "== 1-й запуск"
DEPLOY_REPO=git@github.com:owner/avtodrop-deploy.git GCS_BUCKET=avtodrop-backups bash "$OPS/setup-ops.sh" > "$T/out1.txt" 2>&1; rc=$?
check "код 0" [ $rc = 0 ]
check "/opt/avtodrop тепер symlink" [ -L "$R/opt/avtodrop" ]
check "старий код у releases/initial-*" ls "$R"/opt/avtodrop-releases/initial-*/server.js
check "staging — копія релізу" ls "$R"/opt/avtodrop-staging-releases/initial-copy-*/server.js
check "ops.conf має DEPLOY_REPO і GCS_BUCKET" grep -q "DEPLOY_REPO='git@github.com:owner/avtodrop-deploy.git'" "$R/etc/avtodrop-ops/ops.conf"
check "drop-in Restart=always" grep -q Restart=always "$R/etc/systemd/system/avtodrop.service.d/ops.conf"
check "unit staging з InaccessiblePaths" grep -q InaccessiblePaths "$R/etc/systemd/system/avtodrop-staging.service"
check "таймери скопійовано" ls "$R/etc/systemd/system/avtodrop-deploy@.timer" "$R/etc/systemd/system/avtodrop-watchdog.timer" "$R/etc/systemd/system/avtodrop-backup.timer"
check "daemon-reload викликано" grep -q "systemctl daemon-reload" "$T/calls.log"
check "Caddyfile: прод + /_ops + staging з basicauth" grep -q basicauth "$R/etc/caddy/Caddyfile"
check "Caddyfile: старий збережено" ls "$R"/etc/caddy/Caddyfile.bak-*
check "logrotate" grep -q copytruncate "$R/etc/logrotate.d/avtodrop"
check "env staging 600 і без токена проду" sh -c "[ \$(stat -c %a '$R/etc/avtodrop-staging.env') = 600 ] && ! grep -q AAsecret '$R/etc/avtodrop-staging.env'"
check "вивід містить публічний ключ" grep -q "AAAAFAKEPUBLICKEY" "$T/out1.txt"
check "вивід без токена/ADMIN_KEY/пароля staging" sh -c "! grep -Eq 'AAsecret|supersecretadminkey|$(cat "$R/etc/avtodrop-ops/staging-pass")|PRIVATE' '$T/out1.txt'"
check "бот отримав ключ і пароль staging" grep -q "AAAAFAKEPUBLICKEY" "$T/notify.log"
check "бот: посилання на Deploy keys" grep -q "github.com/owner/avtodrop-deploy/settings/keys/new" "$T/notify.log"

echo "== 2-й запуск (ідемпотентність)"
rel1=$(readlink "$R/opt/avtodrop"); pass1=$(cat "$R/etc/avtodrop-ops/staging-pass"); : > "$T/notify.log"
bash "$OPS/setup-ops.sh" > "$T/out2.txt" 2>&1; rc=$?
check "код 0" [ $rc = 0 ]
check "symlink той самий" [ "$(readlink "$R/opt/avtodrop")" = "$rel1" ]
check "одна папка initial-*" [ "$(ls -d "$R"/opt/avtodrop-releases/initial-* | wc -l)" = 1 ]
check "DEPLOY_REPO збережено без параметра" grep -q "DEPLOY_REPO='git@github.com:owner/avtodrop-deploy.git'" "$R/etc/avtodrop-ops/ops.conf"
check "пароль staging не змінився" [ "$(cat "$R/etc/avtodrop-ops/staging-pass")" = "$pass1" ]
check "пароль удруге ботом не шлеться" sh -c "! grep -q '$pass1' '$T/notify.log'"
check "ключ не перегенеровано" grep -q AAAAFAKEPUBLICKEY "$R/etc/avtodrop-ops/deploy_key.pub"

echo "== тестовий бот для staging"
STAGING_BOT_TOKEN=111111111:AAsecretsecretsecretsecretsecretsec bash "$OPS/setup-ops.sh" > "$T/out3.txt" 2>&1; rc=$?
check "токен проду як staging — відмова" [ $rc != 0 ]
STAGING_BOT_TOKEN=222222222:BBtesttesttesttesttesttesttesttest bash "$OPS/setup-ops.sh" > "$T/out4.txt" 2>&1
check "з тестовим ботом basicauth знято" sh -c "! grep -q basicauth '$R/etc/caddy/Caddyfile'"
check "токен не у виводі" sh -c "! grep -q BBtest '$T/out4.txt'"
echo; echo "РЕЗУЛЬТАТ: $PASS пройдено, $FAIL провалено   (тека: $T)"
[ $FAIL = 0 ]

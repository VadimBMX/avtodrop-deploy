# shellcheck shell=bash disable=SC2034
# Спільні функції ops-скриптів АВТОДРОП. Підключається через `source`.
# Правило: жодних секретів у вивід/логи (токен бота читаємо з env-файлу й передаємо curl через stdin).

OPS_CONF_DIR=${OPS_CONF_DIR:-/etc/avtodrop-ops}
OPS_LIB=${OPS_LIB:-/usr/local/lib/avtodrop-ops}

# ---------- конфіг ----------
load_global() {
  # значення за замовчуванням (перевизначаються в $OPS_CONF_DIR/ops.conf)
  DEPLOY_REPO=""
  SSH_KEY="$OPS_CONF_DIR/deploy_key"
  KNOWN_HOSTS="$OPS_CONF_DIR/known_hosts"
  STATUS_REPO=""
  STATUS_KEY="$OPS_CONF_DIR/status_key"
  GCS_BUCKET=""
  NOTIFY_ENV=/etc/avtodrop.env
  NOTIFY_IDS=""
  STATE_ROOT=/var/lib/avtodrop-ops
  PUBLIC_DIR=/var/lib/avtodrop-ops/public
  BACKUP_ROOT=/var/backups/avtodrop
  OPS_LOG=/var/log/avtodrop-ops.log
  APP_USER=avtodrop
  PROD_DB=/data/avtodrop.db
  KEEP_PREDEPLOY=20
  KEEP_RELEASES=5
  KEEP_DAILY=7
  KEEP_WEEKLY=4
  SANDBOX=auto            # auto|1|0 — запуск перевірки нової версії в ізольованому systemd-run
  SYSTEMCTL=systemctl
  # shellcheck source=/dev/null
  [ -f "$OPS_CONF_DIR/ops.conf" ] && . "$OPS_CONF_DIR/ops.conf"
  mkdir -p "$STATE_ROOT" "$PUBLIC_DIR"
}

load_instance() {
  INSTANCE=$1
  case "$INSTANCE" in prod|staging) ;; *) die "невідомий інстанс '$INSTANCE' (prod|staging)";; esac
  [ -f "$OPS_CONF_DIR/$INSTANCE.conf" ] || die "немає $OPS_CONF_DIR/$INSTANCE.conf (запусти setup-ops.sh)"
  RUN_USER=""; SANITY_PORT=""; PUBLIC_URL=""; LOG_FILE=""
  # shellcheck source=/dev/null
  . "$OPS_CONF_DIR/$INSTANCE.conf"
  : "${SERVICE:?}" "${BRANCH:?}" "${PORT:?}" "${APP_LINK:?}" "${RELEASES_DIR:?}" "${DATA_DIR:?}" "${ENV_FILE:?}"
  STATE="$STATE_ROOT/$INSTANCE"
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  LOCK_FILE="$STATE/deploy.lock"
}

# ---------- лог ----------
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s [%s] %s\n' "$(ts)" "${INSTANCE:-ops}" "$*" | tee -a "$OPS_LOG" >&2; }
die() { log "ПОМИЛКА: $*"; exit 1; }

# Прибрати з тексту все, що схоже на токен бота / ключ.
scrub() { sed -E 's/[0-9]{6,12}:[A-Za-z0-9_-]{30,}/<token>/g; s/(ADMIN_KEY|BOT_TOKEN|KEY|PASS(WORD)?)=[^ ]+/\1=<hidden>/g'; }

# ---------- Telegram ----------
env_get() { # env_get FILE KEY  — значення без source (файл може містити будь-що)
  [ -r "$1" ] || return 0
  grep -m1 "^$2=" "$1" | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

notify() { # notify "текст" — повідомлення власнику; ніколи не валить скрипт
  local text="[АВТОДРОП ${INSTANCE:-ops}] $*"
  if [ -n "${OPS_NOTIFY_CMD:-}" ]; then printf '%s\n' "$text" | $OPS_NOTIFY_CMD || true; return 0; fi
  local token ids id
  token=$(env_get "$NOTIFY_ENV" BOT_TOKEN)
  ids=${NOTIFY_IDS:-$(env_get "$NOTIFY_ENV" ADMIN_IDS)}
  [ -n "$token" ] && [ -n "$ids" ] || { log "notify: немає BOT_TOKEN/ADMIN_IDS — пропускаю"; return 0; }
  for id in ${ids//,/ }; do
    # URL з токеном іде через stdin (-K -), щоб не світився у ps/логах
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
      curl -sS -m 15 -o /dev/null -K - --data-urlencode "chat_id=$id" --data-urlencode "text=$text" \
        --data-urlencode "disable_web_page_preview=true" 2>/dev/null || log "notify: не вдалося надіслати в $id"
  done
  return 0
}

# Повідомлення лише при зміні стану (щоб не спамити кожні 2 хв).
notify_once() { # notify_once KEY "текст"
  local f="$STATE_ROOT/.notified-${INSTANCE:-ops}" key=$1; shift
  [ "$(cat "$f" 2>/dev/null)" = "$key" ] && return 0
  printf '%s' "$key" > "$f"
  notify "$*"
}
notify_clear() { rm -f "$STATE_ROOT/.notified-${INSTANCE:-ops}"; }

# ---------- запуск від імені користувача ----------
as_user() { # as_user USER cmd... (порожній USER або не root → напряму)
  local u=$1; shift
  if [ -n "$u" ] && [ "$(id -u)" = 0 ] && id -u "$u" >/dev/null 2>&1; then runuser -u "$u" -- "$@"; else "$@"; fi
}

user_dir() { # user_dir DIR USER — папка 700, що належить USER (для знімків бази від його імені)
  mkdir -p "$1"; chmod 700 "$1"
  if [ -n "${2:-}" ] && [ "$(id -u)" = 0 ] && id -u "$2" >/dev/null 2>&1; then chown "$2" "$1"; fi
}

# ---------- здоров'я ----------
health_ok() { # health_ok PORT
  [ "$(curl -fsS -m 4 "http://127.0.0.1:$1/healthz" 2>/dev/null)" = ok ]
}
wait_health() { # wait_health PORT SECONDS
  local i
  for ((i = 0; i < $2; i++)); do health_ok "$1" && return 0; sleep 1; done
  return 1
}

# ---------- база ----------
# db_snapshot SRC OUT USER — цілісний знімок (VACUUM INTO) + перевірка; читає базу від імені власника файлу,
# щоб не створити -wal/-shm, що належать root.
db_snapshot() {
  local src=$1 out=$2 u=${3:-}
  rm -f "$out"
  as_user "$u" env SRC="$src" OUT="$out" node -e '
    const { DatabaseSync } = require("node:sqlite");
    const d = new DatabaseSync(process.env.SRC, { readOnly: true });
    d.prepare("VACUUM INTO ?").run(process.env.OUT); d.close();
    const c = new DatabaseSync(process.env.OUT, { readOnly: true });
    const ok = c.prepare("PRAGMA quick_check").get().quick_check;
    let users = "?"; try { users = c.prepare("select count(*) n from users").get().n; } catch {}
    c.close();
    if (ok !== "ok") { console.error("quick_check: " + ok); process.exit(2); }
    console.log("users=" + users);
  '
}

# keep_newest DIR PATTERN N — лишити N найновіших файлів (за іменем: у ньому час)
keep_newest() {
  local dir=$1 pat=$2 n=$3
  # shellcheck disable=SC2012
  ls -1 "$dir" 2>/dev/null | grep -E "$pat" | sort -r | tail -n +"$((n + 1))" | while read -r f; do rm -f -- "${dir:?}/$f"; done
}

# ---------- git ----------
git_env() {
  if [ -f "$1" ]; then
    export GIT_SSH_COMMAND="ssh -i $1 -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 -o BatchMode=yes -o ConnectTimeout=20"
  else
    unset GIT_SSH_COMMAND
  fi
  export GIT_TERMINAL_PROMPT=0
}
remote_sha() { # remote_sha BRANCH → sha або "" (гілки нема); код 1 = немає доступу
  local out
  git_env "$SSH_KEY"
  out=$(timeout 60 git ls-remote "$DEPLOY_REPO" "refs/heads/$1" 2>&1) || { log "git ls-remote: $(printf '%s' "$out" | tail -1 | scrub)"; return 1; }
  printf '%s' "$out" | awk '{print $1}' | head -1
}

# ---------- статус ----------
json_str() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' -- "$1"; }

write_status() { # write_status RESULT "деталі" — state + публічна копія (без секретів) + історія
  local result=$1 detail=${2:-} f="$STATE/status.json"
  {
    printf '{"instance":%s,"result":%s,"time":%s,' "$(json_str "$INSTANCE")" "$(json_str "$result")" "$(json_str "$(ts)")"
    printf '"sha":%s,"release":%s,"previous_release":%s,"branch_sha":%s,"detail":%s}\n' \
      "$(json_str "$(cat "$STATE/current_sha" 2>/dev/null)")" \
      "$(json_str "$(cat "$STATE/current_release" 2>/dev/null)")" \
      "$(json_str "$(cat "$STATE/previous_release" 2>/dev/null)")" \
      "$(json_str "${BRANCH_SHA:-}")" "$(json_str "$detail")"
  } > "$f.tmp" && mv -f "$f.tmp" "$f"
  printf '%s %s %s %s\n' "$(ts)" "$result" "${BRANCH_SHA:+${BRANCH_SHA:0:12}}" "$detail" >> "$STATE/history.log"
  tail -n 200 "$STATE/history.log" > "$STATE/history.tmp" && mv -f "$STATE/history.tmp" "$STATE/history.log"
  install -m 644 "$f" "$PUBLIC_DIR/$INSTANCE.json"
  tail -n 50 "$STATE/history.log" > "$PUBLIC_DIR/$INSTANCE-history.txt"; chmod 644 "$PUBLIC_DIR/$INSTANCE-history.txt"
  status_push || true
}

# Необов'язково: дзеркалити статуси в окремий GitHub-репозиторій (ключ з правом запису лише на нього),
# щоб асистент у хмарі бачив результат деплою без SSH.
status_push() {
  [ -n "$STATUS_REPO" ] && [ -f "$STATUS_KEY" ] || return 0
  local dir="$STATE_ROOT/status-repo"
  (
    exec 8>"$STATE_ROOT/status.lock"; flock -w 30 8 || exit 0
    git_env "$STATUS_KEY"
    if [ ! -d "$dir/.git" ]; then
      rm -rf "$dir"; timeout 60 git clone -q "$STATUS_REPO" "$dir" 2>/dev/null || { mkdir -p "$dir"; git -C "$dir" init -q; git -C "$dir" remote add origin "$STATUS_REPO"; }
    fi
    cd "$dir" || exit 0
    timeout 60 git fetch -q origin main 2>/dev/null && git reset -q --hard origin/main 2>/dev/null
    cp -f "$PUBLIC_DIR"/*.json "$PUBLIC_DIR"/*.txt . 2>/dev/null
    git add -A
    git -c user.name=avtodrop-vm -c user.email=vm@avtodrop.invalid commit -qm "status $(ts)" 2>/dev/null || exit 0
    timeout 60 git push -q origin HEAD:main 2>&1 | scrub | tail -1 >&2
  )
}

# ---------- релізи ----------
switch_link() { # атомарно перемкнути APP_LINK → TARGET
  local target=$1
  [ -d "$target" ] || die "немає релізу $target"
  if [ -e "$APP_LINK" ] && [ ! -L "$APP_LINK" ]; then die "$APP_LINK — звичайна папка, а не symlink (запусти setup-ops.sh)"; fi
  ln -sfn "$target" "$APP_LINK.new"
  mv -Tf "$APP_LINK.new" "$APP_LINK"
}

restarts_of() { $SYSTEMCTL show -p NRestarts --value "$1" 2>/dev/null || echo 0; }

# Перезапустити сервіс і переконатися, що він живий і стабільний (не падає одразу після старту).
restart_verify() {
  local r0
  $SYSTEMCTL restart "$SERVICE" || return 1
  r0=$(restarts_of "$SERVICE")
  wait_health "$PORT" 45 || return 1
  sleep "${STABLE_SECS:-8}"
  health_ok "$PORT" && $SYSTEMCTL is-active -q "$SERVICE" && [ "$(restarts_of "$SERVICE")" = "$r0" ]
}

log_tail() { tail -n "${1:-12}" "$LOG_FILE" 2>/dev/null | cut -c1-300 | scrub; }

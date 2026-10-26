#!/usr/bin/env bash
# Локальна симуляція ops без systemd і без VM: фейковий systemctl (супервізор з Restart=always),
# локальний bare-репозиторій замість GitHub, справжній server.js гри.
#   bash ops/test/sim.sh [TMPDIR]
# Сценарії: немає гілки → waiting; вдалий деплой; синтаксична помилка (прод не зачеплено); версія падає лише
# в проді → автовідкат; ручний відкат + пропуск коміту; сторож (3 збої → рестарт → «відновлено»);
# щоденний бекап з ротацією; staging + [refresh-db].
set -uo pipefail
OPS=$(cd "$(dirname "$0")/.." && pwd)
WT=$(cd "$OPS/.." && pwd)
T=${1:-$(mktemp -d)}
cleanup() { for f in "$T"/svc/*.pid; do [ -f "$f" ] && kill -KILL -- "-$(cat "$f")" 2>/dev/null; done; return 0; }
cleanup; trap cleanup EXIT
rm -rf "$T"; mkdir -p "$T"/{fakebin,svc,etc,opt,data,data-staging}
PASS=0; FAIL=0
ok() { echo "  ✓ $*"; PASS=$((PASS + 1)); }
bad() { echo "  ✗ $*"; FAIL=$((FAIL + 1)); }
check() { local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
P1=3591 S1=3592 P2=3593 S2=3594

# ---- фейковий systemctl ----
cat > "$T/fakebin/systemctl" <<'EOF'
#!/usr/bin/env bash
# мінімальний systemctl для тесту: restart/start/stop/is-active/show NRestarts, Restart=always через цикл
T=$(cd "$(dirname "$0")/.." && pwd)
q=0; args=()
for a in "$@"; do case "$a" in -q|--quiet) q=1;; *) args+=("$a");; esac; done
cmd=${args[0]}; svc=${args[-1]}; svc=${svc%.service}
D="$T/svc/$svc"; [ -f "$D.def" ] || { [ "$cmd" = stop ] && exit 0; echo "unknown $svc" >&2; exit 5; }
. "$D.def"
stop() { [ -f "$D.pid" ] && { kill -TERM -- "-$(cat "$D.pid")" 2>/dev/null; sleep 0.5; kill -KILL -- "-$(cat "$D.pid")" 2>/dev/null; rm -f "$D.pid"; }; return 0; }
start() {
  echo 0 > "$D.restarts"
  # окрема група процесів (setsid): stop вбиває супервізор і node разом, без гонок
  LINK=$LINK ENVF=$ENVF DATA=$DATA PORT=$PORT LOG=$LOG D=$D setsid bash -c '
    exec 9>&- </dev/null >/dev/null 2>&1; n=0
    while :; do
      ( cd "$(readlink -f "$LINK")" && set -a && . "$ENVF" && set +a && DATA_DIR="$DATA" PORT="$PORT" exec node server.js ) >> "$LOG" 2>&1
      n=$((n + 1)); echo "$n" > "$D.restarts"; sleep 1
    done' &
  echo $! > "$D.pid"
}
case "$cmd" in
  start) [ -f "$D.pid" ] || start;;
  restart) stop; start;;
  stop) stop;;
  is-active) [ -f "$D.pid" ] && kill -0 "$(cat "$D.pid")" 2>/dev/null && { [ $q = 1 ] || echo active; exit 0; }; [ $q = 1 ] || echo inactive; exit 3;;
  show) cat "$D.restarts" 2>/dev/null || echo 0;;
  *) exit 0;;
esac
EOF
chmod +x "$T/fakebin/systemctl"
cat > "$T/svc/avtodrop.def" <<EOF
LINK=$T/opt/avtodrop; ENVF=$T/etc/avtodrop.env; DATA=$T/data; PORT=$P1; LOG=$T/avtodrop.log
EOF
cat > "$T/svc/avtodrop-staging.def" <<EOF
LINK=$T/opt/avtodrop-staging; ENVF=$T/etc/avtodrop-staging.env; DATA=$T/data-staging; PORT=$P2; LOG=$T/avtodrop-staging.log
EOF
printf 'SIM_CRASH=1\nADMIN_IDS=1\n' > "$T/etc/avtodrop.env"   # SIM_CRASH читає лише «погана» версія
printf 'ADMIN_IDS=1\n' > "$T/etc/avtodrop-staging.env"

# ---- конфіг ops ----
cat > "$T/etc/ops.conf" <<EOF
DEPLOY_REPO=file://$T/remote.git
STATE_ROOT=$T/state
PUBLIC_DIR=$T/state/public
BACKUP_ROOT=$T/backups
OPS_LOG=$T/ops.log
APP_USER=
PROD_DB=$T/data/avtodrop.db
SANDBOX=0
SYSTEMCTL=$T/fakebin/systemctl
KEEP_RELEASES=3
KEEP_DAILY=2
EOF
for i in prod staging; do
  if [ $i = prod ]; then s=avtodrop b=deploy p=$P1 sp=$S1 l=avtodrop d=data; else s=avtodrop-staging b=staging p=$P2 sp=$S2 l=avtodrop-staging d=data-staging; fi
  cat > "$T/etc/$i.conf" <<EOF
SERVICE=$s
BRANCH=$b
PORT=$p
SANITY_PORT=$sp
APP_LINK=$T/opt/$l
RELEASES_DIR=$T/opt/$l-releases
DATA_DIR=$T/$d
ENV_FILE=$T/etc/$l.env
RUN_USER=
LOG_FILE=$T/$l.log
PUBLIC_URL=
EOF
done
export OPS_CONF_DIR=$T/etc OPS_NOTIFY_CMD="tee -a $T/notify.log" STABLE_SECS=3
SYS=$T/fakebin/systemctl
B=$OPS/bin
st() { node -p "require('$T/state/public/$1.json').result" 2>/dev/null; }
endswith() { [[ "$(cur)" == *"$1" ]]; }
cur() { basename "$(readlink -f "$T/opt/avtodrop")"; }
hz() { [ "$(curl -fsS -m 3 "http://127.0.0.1:$1/healthz" 2>/dev/null)" = ok ]; }
notes() { cat "$T/notify.log" 2>/dev/null; : > "$T/notify.log"; }

# ---- «GitHub» і початковий прод ----
git clone -q "$WT" "$T/src" && git -C "$T/src" checkout -q --detach HEAD
git init -q --bare "$T/remote.git"
G() { git -C "$T/src" -c user.name=t -c user.email=t@t "$@"; }
mkdir -p "$T/opt/avtodrop-releases/initial"
G archive HEAD | tar -x -C "$T/opt/avtodrop-releases/initial"
ln -s "$T/opt/avtodrop-releases/initial" "$T/opt/avtodrop"
$SYS start avtodrop; sleep 1
for _ in $(seq 30); do hz $P1 && break; sleep 0.5; done
echo "== 0. початковий прод"; check "прод живий на :$P1" hz $P1

echo "== 1. гілки ще немає"
"$B/avtodrop-deploy" prod; check "status=waiting" [ "$(st prod)" = waiting ]

echo "== 1b. немає доступу до репозиторію"
sed -i "s#^DEPLOY_REPO=.*#DEPLOY_REPO=file://$T/nope.git#" "$T/etc/ops.conf"
"$B/avtodrop-deploy" prod 2>/dev/null; "$B/avtodrop-deploy" prod 2>/dev/null
check "status=no_access" [ "$(st prod)" = no_access ]
check "бот: одне повідомлення на 2 спроби" [ "$(grep -c 'Не можу прочитати' "$T/notify.log")" = 1 ]
sed -i "s#^DEPLOY_REPO=.*#DEPLOY_REPO=file://$T/remote.git#" "$T/etc/ops.conf"
"$B/avtodrop-deploy" prod
check "бот: доступ відновлено" grep -q "Доступ до репозиторію деплою є" <(notes)

echo "== 2. вдалий деплой"
G commit -q --allow-empty -m "good 1"; GOOD1=$(G rev-parse HEAD)
G push -q "$T/remote.git" HEAD:refs/heads/deploy
"$B/avtodrop-deploy" prod; rc=$?
check "код 0" [ $rc = 0 ]
check "status=ok" [ "$(st prod)" = ok ]
check "symlink → реліз з ${GOOD1:0:7}" endswith "${GOOD1:0:7}"
check "прод живий" hz $P1
check "бекап перед деплоєм є" ls "$T/backups/predeploy-prod/"avtodrop-*.db.gz
check "бот: Деплой OK" grep -q "Деплой OK" <(notes)
"$B/avtodrop-deploy" prod; check "повторний запуск нічого не робить (той самий коміт)" [ "$(cur)" = "$(ls -1 "$T/opt/avtodrop-releases" | grep "${GOOD1:0:7}")" ]

echo "== 3. синтаксична помилка"
echo 'export const x = ;' > "$T/src/src/broken.js"; G add -A; G commit -q -m "broken syntax"; BAD=$(G rev-parse HEAD)
G push -q "$T/remote.git" HEAD:refs/heads/deploy
before=$(cur); "$B/avtodrop-deploy" prod; rc=$?
check "код ≠ 0" [ $rc != 0 ]
check "прод не перемикався" [ "$(cur)" = "$before" ]
check "status=failed" [ "$(st prod)" = failed ]
check "skip_sha = поганий коміт" [ "$(cat "$T/state/prod/skip_sha")" = "$BAD" ]
check "бот: НЕ виконано" grep -q "НЕ виконано" <(notes)
"$B/avtodrop-deploy" prod; check "поганий коміт не пробується вдруге" [ -z "$(notes)" ]
G reset -q --hard "$GOOD1"

echo "== 4. версія проходить пробний запуск, але падає в проді → автовідкат"
sed -i "1i if (process.env.SIM_CRASH === '1') { console.error('sim crash'); process.exit(1); }" "$T/src/server.js"
G commit -qam "crash only in prod"; CR=$(G rev-parse HEAD)
G push -qf "$T/remote.git" HEAD:refs/heads/deploy
before=$(cur); "$B/avtodrop-deploy" prod; rc=$?
check "код ≠ 0" [ $rc != 0 ]
check "status=rolled_back" [ "$(st prod)" = rolled_back ]
check "symlink повернувся на ${before}" [ "$(cur)" = "$before" ]
check "прод живий після відкату" hz $P1
check "бот: автоматично повернув" grep -q "автоматично повернув" <(notes)
check "реліз падаючої версії лишився на диску (для розбору)" ls -d "$T/opt/avtodrop-releases/"*"${CR:0:7}"

echo "== 5. ще один вдалий деплой, потім ручний відкат"
G reset -q --hard "$GOOD1"; G commit -q --allow-empty -m "good 2"; GOOD2=$(G rev-parse HEAD)
G push -qf "$T/remote.git" HEAD:refs/heads/deploy
"$B/avtodrop-deploy" prod >/dev/null 2>&1
check "good 2 задеплоєно" endswith "${GOOD2:0:7}"
notes >/dev/null
"$B/avtodrop-rollback" prod >/dev/null 2>&1; rc=$?
check "rollback код 0" [ $rc = 0 ]
check "symlink → good 1" endswith "${GOOD1:0:7}"
check "прод живий" hz $P1
check "current_sha = good 1" [ "$(cat "$T/state/prod/current_sha")" = "$GOOD1" ]
"$B/avtodrop-deploy" prod; check "таймер не повертає good 2 (skip)" endswith "${GOOD1:0:7}"
check "бот: Ручний відкат" grep -q "Ручний відкат" <(notes)
G push -qf "$T/remote.git" "$GOOD1":refs/heads/deploy
"$B/avtodrop-deploy" prod >/dev/null 2>&1; check "push старого sha у deploy = no-op, коли він уже працює" endswith "${GOOD1:0:7}"

echo "== 6. сторож"
$SYS stop avtodrop
for _ in 1 2; do "$B/avtodrop-watchdog" 2>/dev/null; done
check "2 збої — ще мовчить" [ -z "$(cat "$T/notify.log" 2>/dev/null)" ]
"$B/avtodrop-watchdog" 2>/dev/null
check "3-й збій → повідомлення" grep -q "не відповідає 3 хв" "$T/notify.log"
for _ in $(seq 30); do hz $P1 && break; sleep 0.5; done
check "сторож перезапустив гру" hz $P1
notes >/dev/null
"$B/avtodrop-watchdog" 2>/dev/null
check "повідомлення «знову відповідає»" grep -q "знову відповідає" <(notes)

echo "== 7. щоденний бекап"
for _ in 1 2 3; do "$B/avtodrop-backup" 2>/dev/null; sleep 1.1; done
check "daily: лишилось 2 (KEEP_DAILY=2)" [ "$(ls "$T/backups/daily" | wc -l)" = 2 ]
check "weekly: 1" [ "$(ls "$T/backups/weekly" | wc -l)" = 1 ]
check "status backup=ok" [ "$(st backup)" = ok ]
check "бекап розпаковується і має таблицю users" node -e "
  const z=require('zlib'),fs=require('fs'),f='$T/backups/daily/'+fs.readdirSync('$T/backups/daily')[0];
  fs.writeFileSync('$T/chk.db', z.gunzipSync(fs.readFileSync(f)));
  const {DatabaseSync}=require('node:sqlite'); new DatabaseSync('$T/chk.db').prepare('select count(*) n from users').get();"

echo "== 8. staging"
G checkout -q "$GOOD2"; G commit -q --allow-empty -m "staging test [refresh-db]"
G push -q "$T/remote.git" HEAD:refs/heads/staging
"$B/avtodrop-deploy" staging; rc=$?
check "staging деплой код 0" [ $rc = 0 ]
check "staging база = копія проду" [ -s "$T/data-staging/avtodrop.db" ]
check "staging живий на :$P2" hz $P2
check "прод не зачеплено" hz $P1
check "status staging=ok" [ "$(st staging)" = ok ]

echo "== 9. секрети не в логах"
printf 'BOT_TOKEN=123456789:AAHsecretsecretsecretsecretsecret12\n' >> "$T/etc/avtodrop.env"
check "scrub ховає токен" [ "$(echo 'x 123456789:AAHsecretsecretsecretsecretsecret12 y' | (. "$OPS/lib/common.sh"; scrub))" = "x <token> y" ]
notok() { ! grep -Eq '[0-9]{6,}:[A-Za-z0-9_-]{30,}' "$T/ops.log" "$T/state/public/"*; }
check "у ops.log і статусах немає токенів" notok

$SYS stop avtodrop; $SYS stop avtodrop-staging
echo
echo "РЕЗУЛЬТАТ: $PASS пройдено, $FAIL провалено   (тека: $T)"
[ $FAIL = 0 ]

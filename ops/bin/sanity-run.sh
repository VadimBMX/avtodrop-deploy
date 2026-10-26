#!/usr/bin/env bash
# Перевірка нової версії ДО перемикання: запуск на тимчасовому порту з КОПІЄЮ бази, без токена бота.
# sanity-run.sh RELEASE_DIR PORT DATA_DIR  → код 0 = ок.
# На сервері запускається через systemd-run з PrivateNetwork=yes (без інтернету, порт не видно назовні,
# бот не стартує) і без доступу до /data.
set -uo pipefail
REL=$1 PORT=$2 DIR=$3
cd "$REL" || exit 1
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$DIR" NODE_ENV=production DATA_DIR="$DIR" PORT="$PORT" \
  node server.js > "$DIR/sanity.log" 2>&1 &
pid=$!
fail() { echo "sanity: $*"; tail -n 15 "$DIR/sanity.log" | cut -c1-300; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; exit 1; }
ok=0
for _ in $(seq 1 90); do
  kill -0 "$pid" 2>/dev/null || fail "процес завершився під час старту"
  [ "$(curl -fsS -m 3 "http://127.0.0.1:$PORT/healthz" 2>/dev/null)" = ok ] && { ok=1; break; }
  sleep 0.5
done
[ $ok = 1 ] || fail "/healthz не відповів за 45 с"
curl -fsS -m 10 "http://127.0.0.1:$PORT/api/config" | grep -q '"images"' || fail "/api/config не віддає конфіг"
curl -fsS -m 10 -o /dev/null "http://127.0.0.1:$PORT/" || fail "головна сторінка не відкривається"
curl -fsS -m 10 -o /dev/null "http://127.0.0.1:$PORT/app.js" || fail "app.js не віддається"
sleep 2
kill -0 "$pid" 2>/dev/null || fail "процес впав після старту"
kill "$pid"; wait "$pid" 2>/dev/null
echo "sanity: ok ($(grep -c . "$DIR/sanity.log") рядків логу)"
exit 0

#!/usr/bin/env bash
# Оновити код гри на машині: завантаж новий /tmp/avtodrop.tar.gz і запусти sudo bash update.sh
# Якщо встановлено ops (ops/setup-ops.sh: /opt/avtodrop — symlink на реліз), архів стає новим релізом
# з автоматичним поверненням попереднього, якщо гра не піднялась. Звичайний шлях деплою тепер — гілка deploy (ops/README-ops.md).
set -euo pipefail
APP=/opt/avtodrop
[ -f /tmp/avtodrop.tar.gz ] || { echo "Немає /tmp/avtodrop.tar.gz"; exit 1; }
health() { for _ in $(seq 1 30); do curl -fs http://127.0.0.1:3100/healthz >/dev/null && return 0; sleep 1; done; return 1; }
if [ -L $APP ]; then
  PREV=$(readlink -f $APP)
  REL=/opt/avtodrop-releases/$(date -u +%Y%m%d-%H%M%S)-manual
  mkdir -p "$REL" && tar -xzf /tmp/avtodrop.tar.gz -C "$REL" && chmod -R u=rwX,go=rX "$REL"
  ln -sfn "$REL" $APP.new && mv -Tf $APP.new $APP
  systemctl restart avtodrop
  if health; then
    S=/var/lib/avtodrop-ops/prod; mkdir -p $S
    basename "$REL" > $S/current_release; basename "$PREV" > $S/previous_release
    # щоб таймер не «повернув» ручне оновлення поточним комітом гілки deploy (новий коміт — задеплоїть як звичайно)
    [ -f $S/current_sha ] && mv -f $S/current_sha $S/skip_sha
    echo "оновлено ($(basename "$REL")), гра: ok"; exit 0
  fi
  echo "гра не піднялась — повертаю $(basename "$PREV"):"; tail -30 /var/log/avtodrop.log
  ln -sfn "$PREV" $APP.new && mv -Tf $APP.new $APP; systemctl restart avtodrop; exit 1
fi
tar -xzf /tmp/avtodrop.tar.gz -C $APP && chown -R avtodrop:avtodrop $APP
systemctl restart avtodrop
health && { echo "оновлено, гра: ok"; exit 0; }
echo "гра не піднялась:"; tail -30 /var/log/avtodrop.log; exit 1

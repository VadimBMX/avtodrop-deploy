#!/usr/bin/env bash
# Оновити код гри на машині: завантаж новий /tmp/avtodrop.tar.gz і запусти sudo bash update.sh
set -euo pipefail
APP=/opt/avtodrop
[ -f /tmp/avtodrop.tar.gz ] || { echo "Немає /tmp/avtodrop.tar.gz"; exit 1; }
tar -xzf /tmp/avtodrop.tar.gz -C $APP && chown -R avtodrop:avtodrop $APP
systemctl restart avtodrop
for i in $(seq 1 15); do curl -fs http://127.0.0.1:3100/healthz >/dev/null && { echo "оновлено, гра: ok"; exit 0; }; sleep 1; done
echo "гра не піднялась:"; tail -30 /var/log/avtodrop.log; exit 1

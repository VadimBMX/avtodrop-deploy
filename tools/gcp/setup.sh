#!/usr/bin/env bash
# АВТОДРОП на Google Cloud (Ubuntu 24.04, e2-micro). Запуск від root: sudo bash setup.sh
# Очікує: /tmp/avtodrop.tar.gz (код гри) і, якщо є, /tmp/avtodrop.db (база з Railway).
# Ставить Node 22, Caddy (HTTPS на <ip>.sslip.io), гру як systemd-сервіс, базу в /data. Можна запускати повторно.
set -euo pipefail
APP=/opt/avtodrop; DATA=/data; ENVF=/etc/avtodrop.env
[ "$(id -u)" = 0 ] || { echo "Запусти через sudo"; exit 1; }
# Файли можна покласти в /tmp або в домашню папку (туди їх кладе кнопка Upload file у SSH-вікні).
for d in /tmp "/home/${SUDO_USER:-}" "$HOME"; do
  [ -f "$d/avtodrop.tar.gz" ] && [ "$d" != /tmp ] && mv -f "$d/avtodrop.tar.gz" /tmp/
  [ -f "$d/avtodrop.db" ] && [ "$d" != /tmp ] && mv -f "$d/avtodrop.db" /tmp/
done
[ -f /tmp/avtodrop.tar.gz ] || { echo "Немає avtodrop.tar.gz (завантаж його через Upload file)"; exit 1; }

IP=$(curl -s -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
HOST="${IP//./-}.sslip.io"
echo "== Зовнішня адреса $IP → https://$HOST"

echo "== Пакети"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
echo "node $(node -v), caddy $(caddy version | cut -d' ' -f1)"

# 1 ГБ RAM: невеликий swap, щоб нічого не вбило по пам'яті.
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Код гри"
id -u avtodrop >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d $APP avtodrop
mkdir -p $APP $DATA
tar -xzf /tmp/avtodrop.tar.gz -C $APP
chown -R avtodrop:avtodrop $APP $DATA

if [ -f /tmp/avtodrop.db ]; then
  if [ -s $DATA/avtodrop.db ]; then
    cp $DATA/avtodrop.db $DATA/avtodrop.before-import.$(date +%Y%m%d-%H%M).db
  fi
  systemctl stop avtodrop 2>/dev/null || true
  rm -f $DATA/avtodrop.db-wal $DATA/avtodrop.db-shm
  cp /tmp/avtodrop.db $DATA/avtodrop.db && chown avtodrop:avtodrop $DATA/avtodrop.db
  echo "База перенесена: $(du -h $DATA/avtodrop.db | cut -f1)"
fi

echo "== Налаштування"
if [ ! -f $ENVF ]; then
  read -rp "BOT_TOKEN (токен бота з BotFather): " BOT_TOKEN
  read -rp "ADMIN_IDS (Telegram id адмінів через кому): " ADMIN_IDS
  read -rp "ADMIN_KEY (довгий ключ адмінки; Enter = згенерувати новий): " ADMIN_KEY
  [ -n "$ADMIN_KEY" ] || ADMIN_KEY=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 40)
  umask 077
  cat > $ENVF <<EOF
BOT_TOKEN=$BOT_TOKEN
ADMIN_IDS=$ADMIN_IDS
ADMIN_KEY=$ADMIN_KEY
EOF
fi
# Адресу тримаємо окремо: вона залежить від IP машини.
grep -q '^WEBAPP_URL=' $ENVF && sed -i "s#^WEBAPP_URL=.*#WEBAPP_URL=https://$HOST#" $ENVF || echo "WEBAPP_URL=https://$HOST" >> $ENVF
chmod 600 $ENVF

cat > /etc/systemd/system/avtodrop.service <<EOF
[Unit]
Description=AVTODROP game
After=network-online.target
Wants=network-online.target

[Service]
User=avtodrop
WorkingDirectory=$APP
EnvironmentFile=$ENVF
Environment=NODE_ENV=production DATA_DIR=$DATA PORT=3100
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
StandardOutput=append:/var/log/avtodrop.log
StandardError=append:/var/log/avtodrop.log

[Install]
WantedBy=multi-user.target
EOF
touch /var/log/avtodrop.log && chown avtodrop /var/log/avtodrop.log

cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	reverse_proxy 127.0.0.1:3100
}
EOF

systemctl daemon-reload
systemctl enable -q avtodrop caddy
systemctl restart avtodrop
systemctl reload caddy || systemctl restart caddy

echo "== Перевірка"
for i in $(seq 1 15); do curl -fs http://127.0.0.1:3100/healthz >/dev/null && break; sleep 1; done
curl -fs http://127.0.0.1:3100/healthz >/dev/null && echo "гра: ok" || { echo "гра не піднялась, лог:"; tail -30 /var/log/avtodrop.log; exit 1; }
for i in $(seq 1 30); do curl -fs "https://$HOST/healthz" >/dev/null && break; sleep 2; done
curl -fs "https://$HOST/healthz" >/dev/null && echo "https: ok" || echo "https ще не готовий (Caddy отримує сертифікат) — спробуй через хвилину: https://$HOST"
echo
echo "Готово. Адреса гри для BotFather: https://$HOST"
echo "Адмінка: https://$HOST/admin.html   Лог: tail -f /var/log/avtodrop.log"

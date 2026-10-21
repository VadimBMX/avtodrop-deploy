#!/usr/bin/env bash
# Цілісний знімок бази (для повернення на Railway або просто бекапу): sudo bash backup.sh → /tmp/avtodrop-backup.db
set -euo pipefail
OUT=${1:-/tmp/avtodrop-backup.db}
rm -f "$OUT"
sudo -u avtodrop node -e "
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync('/data/avtodrop.db', { readOnly: true });
d.exec(\"VACUUM INTO '$OUT'\"); d.close();
const c = new DatabaseSync('$OUT', { readOnly: true });
console.log('перевірка:', c.prepare('PRAGMA integrity_check').get().integrity_check, 'гравців:', c.prepare('select count(*) n from users').get().n);
" 2>/dev/null
chmod 644 "$OUT"; ls -lh "$OUT"

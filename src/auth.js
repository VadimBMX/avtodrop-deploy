import crypto from 'node:crypto';

// Validates Telegram.WebApp.initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
export function verifyInitData(initData, botToken, maxAgeSec = 86400, nowSec = Math.floor(Date.now() / 1000)) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest();
  if (!crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  // Fresh only: not older than maxAgeSec, and not from the future (5 min of clock drift allowed).
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return null;
  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id)) return null;
  return { user, startParam: params.get('start_param') || null, authDate };
}

// Builds a signed initData string — used by tests.
export function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheck).digest('hex'));
  return params.toString();
}

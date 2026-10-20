import { PACKS, fmt, short } from '../public/shared.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBot({ token, webappUrl, admins = [], game, log = console.error }) {
  const base = `https://api.telegram.org/bot${token}/`;
  const canButton = /^https:\/\//.test(webappUrl || '');
  let username = null;
  let offset = 0;
  let stopped = false;

  async function call(method, params = {}) {
    const res = await fetch(base + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const j = await res.json();
    if (!j.ok) throw new Error(`${method}: ${j.description}`);
    return j.result;
  }
  const playButton = () => (canButton ? { inline_keyboard: [[{ text: '🏎 Грати', web_app: { url: webappUrl } }]] } : undefined);
  const send = (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, reply_markup: playButton(), ...extra });

  async function handle(u) {
    if (u.pre_checkout_query) {
      const pq = u.pre_checkout_query;
      const [kind, packId, uid] = String(pq.invoice_payload).split(':');
      const pack = PACKS.find((p) => p.id === packId);
      const ok = kind === 'pack' && pack && Number(uid) === pq.from.id && pq.total_amount === pack.stars && pq.currency === 'XTR';
      await call('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: 'Пакет недійсний, спробуй ще раз з гри' });
      return;
    }
    const m = u.message;
    if (!m || !m.from) return;
    if (m.successful_payment) {
      const sp = m.successful_payment;
      const [, packId, , amount] = String(sp.invoice_payload).split(':');
      game.creditPayment({ chargeId: sp.telegram_payment_charge_id, userId: m.from.id, packId, stars: sp.total_amount, amount: Number(amount) });
      return;
    }
    const text = m.text || '';
    const [cmd, ...args] = text.trim().split(/\s+/);
    const isAdmin = admins.includes(m.from.id);
    if (cmd === '/start') {
      game.ensureUser(m.from, args[0]);
      await send(m.chat.id, '🏎 Вітаю в АВТОДРОП!\n\nВідкривай кейси зі справжніми авто, тюнінгуй, ганяй дрег проти інших гравців, торгуй на ринку та обмінюйся машинами.\n\nТисни «Грати» 👇' +
        (canButton ? '' : '\n\n(WEBAPP_URL ще не налаштовано — кнопка гри з’явиться після деплою на https)'));
    } else if (cmd === '/help') {
      await send(m.chat.id, 'Питання по оплаті — /paysupport\nПромокоди шукай у нашому каналі.');
    } else if (cmd === '/paysupport') {
      await send(m.chat.id, 'Опиши проблему з оплатою одним повідомленням і додай час покупки — адміністратор відповість найближчим часом.');
    } else if (isAdmin && cmd === '/promo') {
      const [code, amount, uses, days] = args;
      const c = game.createPromo(code, Number(amount), Number(uses), days ? Number(days) : null);
      await send(m.chat.id, `Промокод ${c}: ${fmt(Number(amount))}, використань: ${uses}${days ? `, днів: ${days}` : ''}`);
    } else if (isAdmin && cmd === '/give') {
      game.adminGive(Number(args[0]), Number(args[1]));
      await send(m.chat.id, `Нараховано ${fmt(Number(args[1]))} гравцю ${args[0]}`);
    } else if (isAdmin && cmd === '/admin') {
      await send(m.chat.id, canButton ? 'Адмін-панель 👇' : 'Адмін-панель відкривається з https-адреси гри: WEBAPP_URL/admin.html (ще не налаштовано).',
        canButton ? { reply_markup: { inline_keyboard: [[{ text: '🛠 Адмін-панель', web_app: { url: webappUrl.replace(/\/$/, '') + '/admin.html' } }]] } } : {});
    } else if (isAdmin && cmd === '/stats') {
      const s = game.stats();
      await send(m.chat.id, `Гравців: ${s.users}\nАктивні за 24 год: ${s.active24h}\nАвто: ${s.cars}\nЗірок отримано: ${s.stars}`);
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        const ups = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'pre_checkout_query'] });
        for (const u of ups) {
          offset = u.update_id + 1;
          await handle(u).catch((e) => log('bot update:', e.message));
        }
      } catch (e) {
        log('bot poll:', e.message);
        await sleep(5000);
      }
    }
  }

  return {
    get username() {
      return username;
    },
    async start() {
      const me = await call('getMe');
      username = me.username;
      await call('deleteWebhook').catch(() => {});
      if (canButton) await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Грати', web_app: { url: webappUrl } } }).catch((e) => log(e.message));
      await call('setMyCommands', { commands: [{ command: 'start', description: 'Відкрити гру' }, { command: 'help', description: 'Допомога' }, { command: 'paysupport', description: 'Питання по оплаті' }] }).catch(() => {});
      loop();
      return username;
    },
    stop() {
      stopped = true;
    },
    notify(uid, text) {
      send(uid, text).catch(() => {});
    },
    // amount: what this player gets for the pack (grows with level and garage), carried in the payload to the payment.
    invoiceLink(uid, packId, amount) {
      const pack = PACKS.find((p) => p.id === packId);
      if (!pack) throw new Error('bad pack');
      const title = short(amount || pack.amount);
      return call('createInvoiceLink', {
        title: `${title} в АВТОДРОП`,
        description: 'Ігрові гривні зарахуються одразу після оплати. Їх не можна вивести чи обміняти на реальні гроші.',
        payload: `pack:${pack.id}:${uid}:${amount || pack.amount}`,
        currency: 'XTR',
        prices: [{ label: title, amount: pack.stars }],
      });
    },
  };
}

import { PACKS, SHOP_BY_ID, ALL_MODELS, MAIN_COUNTRIES, REF_FRIEND_BONUS, fmt, short } from '../public/shared.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARS = ALL_MODELS.filter((m) => !m.secret).length;
// Shown in the empty chat before /start (Telegram: up to 512 characters) and in the bot's profile / shares (up to 120).
export const BOT_DESCRIPTION = `🏁 АВТОДРОП — гараж мрії прямо в Telegram.

🎁 Перший кейс безкоштовний — справжнє авто вже чекає
🚗 ${CARS} машини: від «Запорожця» до Bugatti, класи D → S
💰 Гараж заробляє щогодини, навіть коли ти офлайн
🏎 Дрег-гонки з передачами, дрифт і PvP
🔁 Ринок, аукціони, обмін із друзями
🗝 ${MAIN_COUNTRIES.length} колекцій країн із секретними авто

Тисни «Старт» і забирай свій кейс 👇`;
export const BOT_SHORT_DESCRIPTION = `Кейси зі справжніми авто, гонки й гараж, що заробляє. Перший кейс — безкоштовно 🎁`;

// The /start reply. created: the player is new; ref: came by a friend's link (got the friend bonus);
// pushBack: reminders were off and /start turned them on again; canButton: the «Грати» button can be shown.
export function startText({ name, created = false, ref = false, pushBack = false, canButton = true } = {}) {
  const hi = name ? `Привіт, ${name}!` : 'Привіт!';
  const lines = [];
  if (pushBack) lines.push('🔔 Нагадування знову увімкнено.', '');
  lines.push(created ? `🏁 ${hi} Вітаємо в АВТОДРОПі — тут збирають гараж мрії.` : `🏁 ${hi} Гараж чекає на тебе.`, '');
  lines.push(
    created ? '🎁 Стартовий кейс уже твій — відкрий безкоштовно' : '🎁 Щоденний бонус і кейс нагород — забирай щодня',
    `🚗 ${CARS} справжні авто: від «Запорожця» до Bugatti`,
    '🏎 Гараж заробляє, поки ти ганяєш дрег проти інших',
  );
  if (ref) lines.push('', `👥 Тебе запросив друг — +${fmt(REF_FRIEND_BONUS)} і безкоштовний кейс «Міський» на старт!`);
  lines.push('', canButton ? 'Тисни «Грати» 👇' : '(WEBAPP_URL ще не налаштовано — кнопка гри з’явиться після деплою на https)');
  return lines.join('\n');
}

export function createBot({ token, webappUrl, admins = [], game, log = console.error }) {
  const base = `https://api.telegram.org/bot${token}/`;
  const canButton = /^https:\/\//.test(webappUrl || '');
  let username = null;
  let offset = 0;
  let stopped = false;

  async function call(method, params = {}) {
    const res = await fetch(base + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const j = await res.json();
    if (!j.ok) {
      // error_code 403 = the player blocked the bot (or never started it); 429 = too many requests, wait retry_after s.
      const e = new Error(`${method}: ${j.description}`);
      e.code = j.error_code;
      e.retryAfter = j.parameters?.retry_after;
      throw e;
    }
    return j.result;
  }
  const playButton = (text = '🏎 Грати') => (canButton ? { inline_keyboard: [[{ text, web_app: { url: webappUrl } }]] } : undefined);
  const send = (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, reply_markup: playButton(), ...extra });

  async function handle(u) {
    if (u.pre_checkout_query) {
      const pq = u.pre_checkout_query;
      const [kind, packId, uid] = String(pq.invoice_payload).split(':');
      const pack = PACKS.find((p) => p.id === packId);
      let ok = Number(uid) === pq.from.id && pq.currency === 'XTR';
      if (kind === 'pack') ok = ok && pack && pq.total_amount === pack.stars;
      else if (kind === 'item') {
        // Checked again at payment time: the starter pack once, the pass once a season, the slot price may have grown.
        try {
          ok = ok && pq.total_amount === game.itemPrice(pq.from.id, packId);
        } catch {
          ok = false;
        }
      } else ok = false;
      await call('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: 'Пакет недійсний, спробуй ще раз з гри' });
      return;
    }
    const m = u.message;
    if (!m || !m.from) return;
    if (m.successful_payment) {
      const sp = m.successful_payment;
      const [kind, packId, , amount] = String(sp.invoice_payload).split(':');
      if (kind === 'item') {
        const r = game.creditItem({ chargeId: sp.telegram_payment_charge_id, userId: m.from.id, itemId: packId, stars: sp.total_amount });
        if (r?.refund) {
          await call('refundStarPayment', { user_id: m.from.id, telegram_payment_charge_id: sp.telegram_payment_charge_id });
          await send(m.chat.id, 'Цю покупку вже зроблено раніше — зірки повернуто.');
        }
        return;
      }
      game.creditPayment({ chargeId: sp.telegram_payment_charge_id, userId: m.from.id, packId, stars: sp.total_amount, amount: Number(amount) });
      return;
    }
    const text = m.text || '';
    const [cmd, ...args] = text.trim().split(/\s+/);
    const isAdmin = admins.includes(m.from.id);
    // The player wrote to the bot, so it can write to them again (a 403 earlier marked them blocked).
    if (m.chat.type === 'private') game.push?.unblock(m.from.id);
    if (cmd === '/stop') {
      game.push?.set(m.from.id, false);
      await send(m.chat.id, '🔕 Нагадування вимкнено. Повідомлення про обміни, PvP і аукціони приходитимуть і далі.\n\nУвімкнути знову: /start або «Меню → Нагадування від бота» в грі.');
    } else if (cmd === '/start') {
      const u = game.ensureUser(m.from, args[0]) || {};
      const wasOff = !!game.push?.isOff(m.from.id);
      if (wasOff) game.push.set(m.from.id, true);
      await send(m.chat.id, startText({ name: m.from.first_name, created: !!u.created, ref: !!u.ref, pushBack: wasOff, canButton }));
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

  // A shop item (VIP, pass, starter pack…) at the player's current price.
  function itemInvoiceLink(uid, itemId, price) {
    const it = SHOP_BY_ID[itemId];
    if (!it) throw new Error('bad item');
    return call('createInvoiceLink', {
      title: `${it.name} · АВТОДРОП`,
      description: 'Зарахується одразу після оплати. Ігрові цінності не можна вивести чи обміняти на реальні гроші.',
      payload: `item:${it.id}:${uid}:${price}`,
      currency: 'XTR',
      prices: [{ label: it.name, amount: price }],
    });
  }

  // A drop card the player can send to any chat from the Mini App (WebApp.shareMessage, Bot API 8.0): a photo with a
  // caption and a «Грати» button that opens the bot with the player's referral link. Returns the prepared message id.
  async function prepareShare(uid, { photoUrl, caption, link }) {
    const r = await call('savePreparedInlineMessage', {
      user_id: uid,
      result: {
        type: 'photo', id: crypto.randomUUID().slice(0, 32), photo_url: photoUrl, thumbnail_url: photoUrl, caption: String(caption).slice(0, 1024),
        reply_markup: { inline_keyboard: [[{ text: '🏎 Грати в АВТОДРОП', url: link }]] },
      },
      allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true, allow_bot_chats: false,
    });
    return r.id;
  }

  return {
    itemInvoiceLink,
    prepareShare,
    get username() {
      return username;
    },
    async start() {
      const me = await call('getMe');
      username = me.username;
      await call('deleteWebhook').catch(() => {});
      if (canButton) await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Грати', web_app: { url: webappUrl } } }).catch((e) => log(e.message));
      await call('setMyCommands', { commands: [{ command: 'start', description: 'Відкрити гру' }, { command: 'help', description: 'Допомога' }, { command: 'paysupport', description: 'Питання по оплаті' }, { command: 'stop', description: 'Вимкнути нагадування' }] }).catch(() => {});
      // The selling text in the empty chat and the profile: set only when it differs (they rarely change).
      await call('getMyDescription').then((d) => d.description !== BOT_DESCRIPTION && call('setMyDescription', { description: BOT_DESCRIPTION })).catch((e) => log(e.message));
      await call('getMyShortDescription').then((d) => d.short_description !== BOT_SHORT_DESCRIPTION && call('setMyShortDescription', { short_description: BOT_SHORT_DESCRIPTION })).catch((e) => log(e.message));
      loop();
      return username;
    },
    stop() {
      stopped = true;
    },
    playButton,
    // Used by the send queue (src/reminders.js); rejects with e.code 403 / 429 so the queue can react.
    sendMessage: (chatId, text, extra) => send(chatId, text, extra || {}),
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

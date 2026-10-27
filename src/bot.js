import { PACKS, PACKS_ON_SALE, SHOP_BY_ID, VIP_SUB, ALL_MODELS, MAIN_COUNTRIES, REF_FRIEND_BONUS, fmt, short } from '../public/shared.js';
import { CH_PARAM, challengeLine } from '../public/ghost.js';
import fs from 'node:fs';

// One-off owner messages by @username (src/outbox.json), re-read on each /start so a waiting one goes out then.
const outbox = () => { try { return JSON.parse(fs.readFileSync(new URL('./outbox.json', import.meta.url), 'utf8')); } catch { return []; } };

export const ME_EVERY = 3600e3; // getMe again every hour
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARS = ALL_MODELS.filter((m) => !m.secret).length;
// Shown in the empty chat before /start (Telegram: up to 512 characters) and in the bot's profile / shares (up to 120).
export const BOT_DESCRIPTION = `🏁 АВТОДРОП — гараж мрії прямо в Telegram.

🎁 Перший кейс безкоштовний — справжнє авто вже чекає
🚗 ${CARS} машини: від «Запорожця» до Bugatti, класи D → S
💰 Гараж заробляє щогодини, навіть коли ти офлайн
🏎 Драг-гонки з передачами, дрифт і PvP
🔁 Ринок, аукціони, обмін із друзями
🗝 ${MAIN_COUNTRIES.length} колекцій країн із секретними авто

Тисни «Старт» і забирай свій кейс 👇`;
export const BOT_SHORT_DESCRIPTION = `Кейси зі справжніми авто, гонки й гараж, що заробляє. Перший кейс — безкоштовно 🎁`;

// The /start reply. created: the player is new; ref: came by a friend's link (got the friend bonus);
// pushBack: reminders were off and /start turned them on again; canButton: the «Грати» button can be shown;
// challenge: came by a ghost challenge's link ({ who, model, time }, game.challengeInfo) — the reply leads with it.
export function startText({ name, created = false, ref = false, pushBack = false, canButton = true, challenge = null } = {}) {
  const hi = name ? `Привіт, ${name}!` : 'Привіт!';
  const lines = [];
  if (pushBack) lines.push('🔔 Нагадування знову увімкнено.', '');
  if (challenge) lines.push(`👻 ${challenge.who} кидає тобі виклик: ${challengeLine(challenge.model, challenge.time)}`, challenge.expired ? 'Термін цього виклику вже минув — але можна кинути свій!' : 'Їдь проти його привида — тисни «Прийняти виклик» 👇', '');
  lines.push(created ? `🏁 ${hi} Вітаємо в АВТОДРОПі — тут збирають гараж мрії.` : `🏁 ${hi} Гараж чекає на тебе.`, '');
  lines.push(
    created ? '🎁 Стартовий кейс уже твій — відкрий безкоштовно' : '🎁 Щоденний бонус і кейс нагород — забирай щодня',
    `🚗 ${CARS} справжні авто: від «Запорожця» до Bugatti`,
    '🏎 Гараж заробляє, поки ти ганяєш драг проти інших',
  );
  if (ref) lines.push('', `👥 Тебе запросив друг — +${fmt(REF_FRIEND_BONUS)} і безкоштовний кейс «Міський» на старт!`);
  lines.push('', canButton ? 'Тисни «Грати» 👇' : '(WEBAPP_URL ще не налаштовано — кнопка гри з’явиться після деплою на https)');
  return lines.join('\n');
}

// The command menu (setMyCommands), Ukrainian. Admins get theirs on top, in their own chats only.
// The welcome post for the players' chat (the owner's /welcome in the «Новини» topic).
export const WELCOME_TEXT = `🏁 Ласкаво просимо в АВТОДРОП!

Це гра в Telegram, де ти збираєш гараж мрії зі справжніх авто — від «Запорожця» до гіперкарів.

🎰 Кейси зі 170+ справжніми машинами — перший безкоштовно
💰 Гараж заробляє, навіть коли ти не в грі
🏎 Драг, дрифт і 27 босів кар’єри
🔨 Аукціон контейнерів о 20:00, обміни й ринок між гравцями
👥 Автоклуби й турнір вихідних

📣 У цій темі — оновлення, події й промокоди (пишуть лише адміни)
💬 У темі «Чат» — хвалися дропами, шукай обміни, питай поради

🎁 Бонус за вступ: у грі Меню → «Наші групи в Telegram» → «Забрати» — ключ від кейсу «Міський».

👉 Грати: @avtodrop2026_bot`;
export const COMMANDS = [
  { command: 'start', description: '🏎 Відкрити гру' },
  { command: 'garage', description: '🚗 Мій гараж: баланс, каса, найкраще авто' },
  { command: 'settings', description: '🔔 Нагадування: що приходить і як вимкнути' },
  { command: 'help', description: '❓ Як грати і допомога' },
  { command: 'paysupport', description: '⭐ Питання щодо оплати зірками' },
  { command: 'stop', description: '🔕 Вимкнути всі нагадування' },
];
export const ADMIN_COMMANDS = [
  { command: 'admin', description: '🛠 Адмін-панель' },
  { command: 'stats', description: '📊 Гравці й активність' },
  { command: 'promo', description: 'Промокод: код сума використань [днів]' },
  { command: 'give', description: 'Нарахувати: id сума' },
];
export const HELP_TEXT = `🏁 АВТОДРОП — кейси зі справжніми авто, гараж, що заробляє, і гонки.

Як грати: відкривай кейси → став авто в гараж (він заробляє щогодини) → ганяй драг і дрифт → збирай колекції країн.

Команди:
/garage — коротко про твій гараж
/settings — які нагадування приходять
/stop — вимкнути всі нагадування (/start — увімкнути)
/paysupport — питання щодо оплати зірками

Кинути виклик другу в будь-якому чаті: напиши @{bot} і вибери картку.
Промокоди шукай у нашому каналі.`;
// The /garage reply (s: game.push.summary(uid)).
export function garageText(s) {
  if (!s) return 'Гараж ще порожній — тисни «Грати» і відкрий перший кейс безкоштовно 🎁';
  const lines = [`🚗 Твій гараж · рівень ${s.level}`, `💰 Баланс: ${fmt(s.balance)}`, `🏎 Авто: ${s.cars}${s.best ? ` · найкраще — ${s.best.name} (${s.best.cls})` : ''}`];
  if (s.rate > 0) lines.push(s.full ? `📦 Каса гаража повна: ${short(s.pending)} — забери, далі дохід не росте` : `📦 У касі: ${short(s.pending)} · +${short(s.rate)}/год`);
  return lines.join('\n');
}
// The /settings reply: which reminders this player gets.
export function settingsText({ off = false, mute = [], groups = [] } = {}) {
  if (off) return '🔕 Нагадування вимкнено (/stop).\n\nУвімкнути: /start або «Меню → Налаштування» в грі.\nПро обміни, PvP і аукціони бот пише завжди.';
  const lines = ['🔔 Нагадування: до 2 на день, не вночі (22:00–09:00 за Києвом), лише коли тебе немає в грі.', ''];
  for (const g of groups) lines.push(`${mute.includes(g.id) ? '▫️' : '✅'} ${g.title} — ${g.hint}`);
  lines.push('', 'Перемкнути кожен тип: «Меню → Налаштування» в грі. Вимкнути все: /stop');
  return lines.join('\n');
}

// inline(query, from) → results for the bot's inline mode (server.js: a ghost challenge card or an invite), or null.
export function createBot({ token, webappUrl, admins = [], game, inline = null, log = console.error }) {
  const base = `https://api.telegram.org/bot${token}/`;
  const canButton = /^https:\/\//.test(webappUrl || '');
  let username = null, inlineOn = false, meTimer = null;
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
    if (u.inline_query) {
      const iq = u.inline_query;
      const results = (inline && (await inline(iq.query, iq.from))) || [];
      await call('answerInlineQuery', { inline_query_id: iq.id, results, cache_time: 10, is_personal: true });
      return;
    }
    if (u.pre_checkout_query) {
      const pq = u.pre_checkout_query;
      const [kind, packId, uid, price] = String(pq.invoice_payload).split(':');
      const pack = PACKS.find((p) => p.id === packId);
      let ok = Number(uid) === pq.from.id && pq.currency === 'XTR';
      let why = 'Пакет недійсний, спробуй ще раз з гри';
      // Hryvnia packs are off sale (S.PACKS_ON_SALE): an old invoice is declined here, so no stars are taken.
      if (kind === 'pack') {
        ok = ok && PACKS_ON_SALE && !!pack && pq.total_amount === pack.stars;
        if (!PACKS_ON_SALE) why = 'Пакети гривень більше не продаються — у магазині гри є «Стиль» і VIP';
      } else if (kind === 'item' && SHOP_BY_ID[packId]?.sub) {
        // The VIP subscription: its price is fixed in the invoice (renewals keep it), a second one is refunded later.
        ok = ok && pq.total_amount === Number(price) && pq.total_amount > 0;
      } else if (kind === 'item') {
        // Checked again at payment time: the starter pack once, the pass once a season, a cosmetic once, the slot price may have grown.
        try {
          ok = ok && pq.total_amount === game.itemPrice(pq.from.id, packId);
        } catch (e) {
          ok = false;
          if (e?.message) why = e.message.slice(0, 200);
        }
      } else ok = false;
      await call('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: why });
      return;
    }
    const m = u.message;
    if (!m || !m.from) return;
    if (m.successful_payment) {
      const sp = m.successful_payment;
      const [kind, packId, , amount] = String(sp.invoice_payload).split(':');
      if (kind === 'item') {
        // Subscription payments (VIP_SUB) carry is_recurring; the first one also is_first_recurring, renewals don't.
        const r = game.creditItem({ chargeId: sp.telegram_payment_charge_id, userId: m.from.id, itemId: packId, stars: sp.total_amount,
          recurring: !!sp.is_recurring, first: !!sp.is_first_recurring, expires: sp.subscription_expiration_date ? sp.subscription_expiration_date * 1000 : 0 });
        if (r?.refund) {
          // A second VIP subscription next to the running one: stop its renewals too, then give the stars back.
          if (r.cancelSub) await editStarSubscription(m.from.id, sp.telegram_payment_charge_id, true).catch((e) => log('sub cancel:', e.message));
          await call('refundStarPayment', { user_id: m.from.id, telegram_payment_charge_id: sp.telegram_payment_charge_id });
          await send(m.chat.id, r.cancelSub ? 'VIP-підписка в тебе вже діє — другу скасовано, зірки повернуто.' : 'Цю покупку вже зроблено раніше — зірки повернуто.');
        }
        return;
      }
      game.creditPayment({ chargeId: sp.telegram_payment_charge_id, userId: m.from.id, packId, stars: sp.total_amount, amount: Number(amount) });
      return;
    }
    const text = m.text || '';
    const [cmd, ...args] = text.trim().split(/\s+/);
    const isAdmin = admins.includes(m.from.id);
    // Groups (the players' chat, owner 28.10): the bot answers nothing there — only the owner's /welcome, written in a
    // topic, makes it post the welcome message into that topic, pin it and remove the command.
    if (m.chat.type !== 'private') {
      if (isAdmin && cmd.split('@')[0] === '/welcome') {
        const thread = m.is_topic_message ? { message_thread_id: m.message_thread_id } : {};
        const posted = await call('sendMessage', { chat_id: m.chat.id, text: WELCOME_TEXT, link_preview_options: { is_disabled: true }, ...thread });
        await call('pinChatMessage', { chat_id: m.chat.id, message_id: posted.message_id, disable_notification: true }).catch((e) => log('welcome pin:', e.message));
        await call('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id }).catch(() => {});
      }
      return;
    }
    // The player wrote to the bot, so it can write to them again (a 403 earlier marked them blocked).
    if (m.chat.type === 'private') game.push?.unblock(m.from.id);
    if (cmd === '/stop') {
      game.push?.set(m.from.id, false);
      await send(m.chat.id, '🔕 Нагадування вимкнено. Повідомлення про обміни, PvP і аукціони приходитимуть і далі.\n\nУвімкнути знову: /start або «Меню → Налаштування» в грі.');
    } else if (cmd === '/start') {
      const u = game.ensureUser(m.from, args[0]) || {};
      try { game.deliverOutbox?.(outbox()); } catch {}
      const wasOff = !!game.push?.isOff(m.from.id);
      if (wasOff) game.push.set(m.from.id, true);
      // A ghost challenge's link: the reply names it and its button opens the game right on the challenge (?ch=<id>).
      const chM = CH_PARAM.exec(args[0] || '');
      const challenge = chM ? game.challengeInfo?.(chM[1]) : null;
      const chUrl = challenge && canButton ? `${webappUrl}${webappUrl.includes('?') ? '&' : '?'}ch=${challenge.id}` : null;
      // A club invite (/start club_<code>): the button opens the game on the invite (?club=<code>, public/clubs-ui.js).
      const clubM = /^club_([a-z0-9]{8})$/.exec(args[0] || '');
      const clubUrl = clubM && canButton && !chUrl ? `${webappUrl}${webappUrl.includes('?') ? '&' : '?'}club=${clubM[1]}` : null;
      await send(m.chat.id, startText({ name: m.from.first_name, created: !!u.created, ref: !!u.ref, pushBack: wasOff, canButton, challenge }),
        chUrl && !challenge.expired ? { reply_markup: { inline_keyboard: [[{ text: '🏁 Прийняти виклик', web_app: { url: chUrl } }]] } }
          : clubUrl ? { reply_markup: { inline_keyboard: [[{ text: '🏁 Вступити в автоклуб', web_app: { url: clubUrl } }]] } } : {});
    } else if (cmd === '/help') {
      await send(m.chat.id, HELP_TEXT.replace('{bot}', username || 'bot'));
    } else if (cmd === '/garage') {
      await send(m.chat.id, garageText(game.push?.summary?.(m.from.id)), { reply_markup: playButton('🚗 Відкрити гараж') });
    } else if (cmd === '/settings') {
      const off = !!game.push?.isOff?.(m.from.id);
      await send(m.chat.id, settingsText({ off, mute: game.push?.muteOf?.(m.from.id) || [], groups: game.push?.groups || [] }));
    } else if (cmd === '/paysupport') {
      await send(m.chat.id, 'Опиши проблему з оплатою одним повідомленням і додай час покупки — адміністратор відповість найближчим часом.');
    } else if (isAdmin && cmd === '/promo') {
      const [code, amount, uses, days] = args;
      const c = game.createPromo(code, Number(amount), Number(uses), days ? Number(days) : null, m.from.id);
      await send(m.chat.id, `Промокод ${c}: ${fmt(Number(amount))}, використань: ${uses}${days ? `, днів: ${days}` : ''}`);
    } else if (isAdmin && cmd === '/give') {
      game.adminGive(Number(args[0]), Number(args[1]), m.from.id);
      await send(m.chat.id, `Нараховано ${fmt(Number(args[1]))} гравцю ${args[0]}`);
    } else if (isAdmin && cmd === '/admin') {
      await send(m.chat.id, canButton ? 'Адмін-панель 👇' : 'Адмін-панель відкривається з https-адреси гри: WEBAPP_URL/admin.html (ще не налаштовано).',
        canButton ? { reply_markup: { inline_keyboard: [[{ text: '🛠 Адмін-панель', web_app: { url: webappUrl.replace(/\/$/, '') + '/admin.html' } }]] } } : {});
    } else if (isAdmin && cmd === '/stats') {
      const s = game.stats();
      await send(m.chat.id, `Гравців: ${s.users}\nАктивні за 24 год: ${s.active24h}\nАвто: ${s.cars}\nЗірок отримано: ${s.stars}`);
    }
  }

  async function refreshMe() {
    const me = await call('getMe');
    if (me?.username) username = me.username;
    inlineOn = !!me?.supports_inline_queries;
    return me;
  }

  async function loop() {
    while (!stopped) {
      try {
        const ups = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'pre_checkout_query', 'inline_query'] });
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

  // A shop item (VIP, pass, starter pack, «Стиль»…) at the player's current price. The VIP subscription is a Telegram
  // Stars subscription invoice (subscription_period: 30 days, renews by itself; the player can cancel in Telegram too).
  function itemInvoiceLink(uid, itemId, price) {
    const it = SHOP_BY_ID[itemId];
    if (!it) throw new Error('bad item');
    const full = `${it.name} · АВТОДРОП`; // Telegram: title 1–32 characters
    return call('createInvoiceLink', {
      title: full.length <= 32 ? full : it.name.slice(0, 32),
      description: it.sub
        ? `VIP на ${VIP_SUB.days} днів, продовжується сам кожні ${VIP_SUB.days} днів. Скасувати можна в магазині гри або в Telegram (Налаштування → Мої зірки).`
        : 'Зарахується одразу після оплати. Ігрові цінності не можна вивести чи обміняти на реальні гроші.',
      payload: `item:${it.id}:${uid}:${price}`,
      currency: 'XTR',
      prices: [{ label: it.name, amount: price }],
      ...(it.sub ? { subscription_period: VIP_SUB.period } : {}),
    });
  }
  // Cancel (true) or resume (false) the renewal of a Stars subscription (Bot API editUserStarSubscription).
  function editStarSubscription(uid, chargeId, cancel) {
    return call('editUserStarSubscription', { user_id: uid, telegram_payment_charge_id: chargeId, is_canceled: !!cancel });
  }

  // A drop card the player can send to any chat from the Mini App (WebApp.shareMessage, Bot API 8.0): a photo with a
  // caption and a «Грати» button that opens the bot with the player's referral link (a ghost challenge: «Прийняти
  // виклик» with the challenge's link, `button`). Returns the prepared message id.
  async function prepareShare(uid, { photoUrl, caption, link, button = '🏎 Грати в АВТОДРОП' }) {
    const r = await call('savePreparedInlineMessage', {
      user_id: uid,
      result: {
        type: 'photo', id: crypto.randomUUID().slice(0, 32), photo_url: photoUrl, thumbnail_url: photoUrl, caption: String(caption).slice(0, 1024),
        reply_markup: { inline_keyboard: [[{ text: button, url: link }]] },
      },
      allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true, allow_bot_chats: false,
    });
    return r.id;
  }

  return {
    itemInvoiceLink,
    editStarSubscription,
    prepareShare,
    call, // the raw Bot API call (src/channel.js posts to the channel with it)
    get username() {
      return username;
    },
    // Inline mode is switched on for the bot in @BotFather (getMe.supports_inline_queries): the app may offer
    // WebApp.switchInlineQuery for a challenge.
    get inline() {
      return inlineOn;
    },
    // getMe again: the owner changes the bot in @BotFather (/setinline, name) while the server runs — picked up hourly.
    refreshMe,
    async start() {
      await refreshMe();
      if (!meTimer) {
        meTimer = setInterval(() => refreshMe().catch((e) => log('getMe:', e.message)), ME_EVERY);
        meTimer.unref?.();
      }
      await call('deleteWebhook').catch(() => {});
      if (canButton) await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Грати', web_app: { url: webappUrl } } }).catch((e) => log(e.message));
      await call('setMyCommands', { commands: COMMANDS }).catch((e) => log(e.message));
      for (const id of admins) await call('setMyCommands', { commands: [...ADMIN_COMMANDS, ...COMMANDS], scope: { type: 'chat', chat_id: id } }).catch(() => {});
      // The selling text in the empty chat and the profile: set only when it differs (they rarely change).
      await call('getMyDescription').then((d) => d.description !== BOT_DESCRIPTION && call('setMyDescription', { description: BOT_DESCRIPTION })).catch((e) => log(e.message));
      await call('getMyShortDescription').then((d) => d.short_description !== BOT_SHORT_DESCRIPTION && call('setMyShortDescription', { short_description: BOT_SHORT_DESCRIPTION })).catch((e) => log(e.message));
      loop();
      return username;
    },
    stop() {
      stopped = true;
      clearInterval(meTimer);
      meTimer = null;
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

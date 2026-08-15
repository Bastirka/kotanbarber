const { Telegraf, Markup } = require('telegraf');
const scheduling = require('./scheduling');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

const bot = new Telegraf(token);
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

function fmtDayTime(date) {
  return new Intl.DateTimeFormat('lv-LV', {
    timeZone: scheduling.TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}
function fmtTime(date) {
  return new Intl.DateTimeFormat('lv-LV', { timeZone: scheduling.TZ, hour: '2-digit', minute: '2-digit' }).format(date);
}
function fmtDayLabel(dateStr) {
  const noon = scheduling.zonedTimeToUtc(dateStr, 12, 0, scheduling.TZ);
  return new Intl.DateTimeFormat('lv-LV', { timeZone: scheduling.TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(noon);
}
function toEpochMin(date) {
  return Math.floor(date.getTime() / 60000);
}
function fromEpochMin(min) {
  return new Date(min * 60000);
}

async function sendServiceList(ctx) {
  const services = await scheduling.getServices();
  const buttons = services.map((s) => [
    Markup.button.callback(`${s.name} · €${s.price_eur} · ${s.duration_min} min`, `svc|${s.id}`),
  ]);
  await ctx.reply(
    'Sveiks Kotānā. Izvēlies pakalpojumu, uz ko pierakstīties:',
    Markup.inlineKeyboard(buttons)
  );
}

async function sendModeChoice(ctx, serviceId) {
  const service = await scheduling.getService(serviceId);
  if (!service) return ctx.reply('Šis pakalpojums vairs nav pieejams.');
  await ctx.editMessageText(
    `${service.name} · €${service.price_eur} · ${service.duration_min} min\n\nKā vēlies pierakstīties?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Tuvākais brīvais laiks (rinda)', `mode|q|${serviceId}`)],
      [Markup.button.callback('Izvēlēties laiku pats', `mode|p|${serviceId}`)],
    ])
  );
}

async function sendQueueOffer(ctx, serviceId) {
  const service = await scheduling.getService(serviceId);
  if (!service) return ctx.reply('Šis pakalpojums vairs nav pieejams.');
  const slot = await scheduling.findNextQueueSlot(service.duration_min);
  if (!slot) {
    return ctx.editMessageText('Diemžēl tuvāko divu nedēļu laikā brīvu vietu nav. Pamēģini vēlreiz vēlāk.');
  }
  await ctx.editMessageText(
    `Tuvākais brīvais laiks: ${fmtDayTime(slot)}\n${service.name} · €${service.price_eur}\n\nApstiprināt?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Jā, pierakstīt', `ok|q|${serviceId}|${toEpochMin(slot)}`)],
      [Markup.button.callback('← Atpakaļ', `svc|${serviceId}`)],
    ])
  );
}

async function sendDayPicker(ctx, serviceId) {
  const service = await scheduling.getService(serviceId);
  if (!service) return ctx.reply('Šis pakalpojums vairs nav pieejams.');
  const today = scheduling.localDateStr(new Date(), scheduling.TZ);
  const buttons = [];
  for (let i = 0; i < 14; i += 1) {
    const dateStr = scheduling.addDays(today, i);
    buttons.push(Markup.button.callback(fmtDayLabel(dateStr), `day|${serviceId}|${dateStr}`));
  }
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  rows.push([Markup.button.callback('← Atpakaļ', `svc|${serviceId}`)]);
  await ctx.editMessageText(`${service.name} — izvēlies dienu:`, Markup.inlineKeyboard(rows));
}

async function sendSlotPicker(ctx, serviceId, dateStr) {
  const service = await scheduling.getService(serviceId);
  if (!service) return ctx.reply('Šis pakalpojums vairs nav pieejams.');
  const slots = await scheduling.getAvailableSlots(dateStr, service.duration_min);
  if (slots.length === 0) {
    return ctx.editMessageText(
      `${fmtDayLabel(dateStr)} brīvu laiku nav.`,
      Markup.inlineKeyboard([[Markup.button.callback('← Citu dienu', `mode|p|${serviceId}`)]])
    );
  }
  const buttons = slots.map((s) => Markup.button.callback(fmtTime(s), `slot|${serviceId}|${toEpochMin(s)}`));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 4) rows.push(buttons.slice(i, i + 4));
  rows.push([Markup.button.callback('← Citu dienu', `mode|p|${serviceId}`)]);
  await ctx.editMessageText(`${service.name} — ${fmtDayLabel(dateStr)}, brīvie laiki:`, Markup.inlineKeyboard(rows));
}

async function sendConfirm(ctx, serviceId, epochMin) {
  const service = await scheduling.getService(serviceId);
  if (!service) return ctx.reply('Šis pakalpojums vairs nav pieejams.');
  const start = fromEpochMin(epochMin);
  await ctx.editMessageText(
    `${service.name} · €${service.price_eur}\n${fmtDayTime(start)}\n\nApstiprināt pierakstu?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Jā, pierakstīt', `ok|p|${serviceId}|${epochMin}`)],
      [Markup.button.callback('← Atpakaļ', `mode|p|${serviceId}`)],
    ])
  );
}

async function bookSlot(ctx, serviceId, epochMin, mode) {
  const service = await scheduling.getService(serviceId);
  if (!service) return ctx.editMessageText('Šis pakalpojums vairs nav pieejams.');
  const startsAt = fromEpochMin(epochMin);
  const endsAt = new Date(startsAt.getTime() + service.duration_min * 60000);
  const clientName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Klients';

  const result = await scheduling.createAppointment({
    serviceId,
    startsAt,
    endsAt,
    clientName,
    telegramUserId: ctx.from.id,
    telegramUsername: ctx.from.username,
    source: 'telegram',
    mode,
  });

  if (!result.ok) {
    return ctx.editMessageText('Diemžēl šo laiku tikko paņēma kāds cits. Izvēlies citu:', Markup.inlineKeyboard([
      [Markup.button.callback('Izvēlēties laiku', `mode|p|${serviceId}`)],
      [Markup.button.callback('Tuvākais brīvais', `mode|q|${serviceId}`)],
    ]));
  }

  await ctx.editMessageText(
    `Pierakstīts.\n${service.name} · €${service.price_eur}\n${fmtDayTime(startsAt)}\n\nGaidīsim tevi Kotānā, Rēzeknē. Ja jāatceļ — /mans`
  );

  if (ADMIN_CHAT_ID) {
    const who = ctx.from.username ? `@${ctx.from.username}` : clientName;
    await ctx.telegram.sendMessage(
      ADMIN_CHAT_ID,
      `Jauns pieraksts: ${service.name} · ${fmtDayTime(startsAt)} · ${who}`
    ).catch(() => {});
  }
}

async function sendMyAppointments(ctx) {
  const upcoming = await scheduling.getUpcomingForUser(ctx.from.id);
  if (upcoming.length === 0) {
    return ctx.reply('Tev nav gaidāmu pierakstu.', Markup.inlineKeyboard([[Markup.button.callback('Pierakstīties', 'svc|__list__')]]));
  }
  for (const a of upcoming) {
    await ctx.reply(
      `${a.service_name} · ${fmtDayTime(new Date(a.starts_at))}`,
      Markup.inlineKeyboard([[Markup.button.callback('Atcelt', `cancel|${a.id}`)]])
    );
  }
}

bot.start((ctx) => sendServiceList(ctx));
bot.command('pieraksts', (ctx) => sendServiceList(ctx));
bot.command('mans', (ctx) => sendMyAppointments(ctx));

bot.action('svc|__list__', async (ctx) => { await ctx.answerCbQuery(); await sendServiceList(ctx); });
bot.action(/^svc\|(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); await sendModeChoice(ctx, Number(ctx.match[1])); });
bot.action(/^mode\|q\|(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); await sendQueueOffer(ctx, Number(ctx.match[1])); });
bot.action(/^mode\|p\|(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); await sendDayPicker(ctx, Number(ctx.match[1])); });
bot.action(/^day\|(\d+)\|(\d{4}-\d{2}-\d{2})$/, async (ctx) => { await ctx.answerCbQuery(); await sendSlotPicker(ctx, Number(ctx.match[1]), ctx.match[2]); });
bot.action(/^slot\|(\d+)\|(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); await sendConfirm(ctx, Number(ctx.match[1]), Number(ctx.match[2])); });
bot.action(/^ok\|(q|p)\|(\d+)\|(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const mode = ctx.match[1] === 'q' ? 'queue' : 'scheduled';
  await bookSlot(ctx, Number(ctx.match[2]), Number(ctx.match[3]), mode);
});
bot.action(/^cancel\|(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const id = Number(ctx.match[1]);
  const upcoming = await scheduling.getUpcomingForUser(ctx.from.id);
  if (!upcoming.some(a => a.id === id)) {
    await ctx.editMessageText('Šo pierakstu nevar atcelt.');
    return;
  }
  const appt = await scheduling.cancelAppointment(id);
  if (appt) {
    await ctx.editMessageText('Pieraksts atcelts.');
    if (ADMIN_CHAT_ID) {
      await ctx.telegram.sendMessage(ADMIN_CHAT_ID, `Atcelts pieraksts #${appt.id} (${fmtDayTime(new Date(appt.starts_at))})`).catch(() => {});
    }
  } else {
    await ctx.editMessageText('Šis pieraksts vairs nav atrodams.');
  }
});

module.exports = { bot };

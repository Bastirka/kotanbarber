const {
  getService,
  findNextQueueSlot,
  getAvailableSlots,
  createAppointment,
  localDateStr,
  TZ,
} = require('../lib/scheduling');

function isValidPhone(phone) {
  return typeof phone === 'string' && /^[0-9+\s()-]{6,20}$/.test(phone.trim());
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const serviceId = Number(body.serviceId);
  const mode = body.mode === 'queue' ? 'queue' : body.mode === 'scheduled' ? 'scheduled' : null;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '';

  if (!serviceId || !mode) {
    res.status(400).json({ error: 'Missing serviceId or mode' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Missing name' });
    return;
  }
  if (!isValidPhone(phone)) {
    res.status(400).json({ error: 'Missing or invalid phone' });
    return;
  }

  const service = await getService(serviceId);
  if (!service) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }

  let startsAt;
  if (mode === 'queue') {
    // Always recomputed server-side — never trust a client-supplied time here.
    startsAt = await findNextQueueSlot(service.duration_min);
    if (!startsAt) {
      res.status(409).json({ error: 'No slots available in the booking horizon' });
      return;
    }
  } else {
    const requested = new Date(body.startsAt);
    if (!body.startsAt || Number.isNaN(requested.getTime())) {
      res.status(400).json({ error: 'Missing or invalid startsAt' });
      return;
    }
    const dateStr = localDateStr(requested, TZ);
    const slots = await getAvailableSlots(dateStr, service.duration_min);
    const match = slots.find((s) => s.getTime() === requested.getTime());
    if (!match) {
      res.status(409).json({ error: 'Slot no longer available' });
      return;
    }
    startsAt = match;
  }

  const endsAt = new Date(startsAt.getTime() + service.duration_min * 60000);
  const result = await createAppointment({
    serviceId,
    startsAt,
    endsAt,
    clientName: name,
    phone,
    source: 'web',
    mode,
  });

  if (!result.ok) {
    res.status(409).json({ error: 'Slot no longer available' });
    return;
  }

  res.status(200).json({
    appointment: {
      id: result.appointment.id,
      startsAt: result.appointment.starts_at,
      endsAt: result.appointment.ends_at,
      serviceName: service.name,
      priceEur: service.price_eur,
    },
  });

  notifyAdmin(service, startsAt, name, phone);
};

// Best-effort — a missing/misconfigured bot must never break a web booking.
function notifyAdmin(service, startsAt, name, phone) {
  if (!process.env.ADMIN_CHAT_ID || !process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    const { bot } = require('../lib/telegram');
    const when = new Intl.DateTimeFormat('lv-LV', {
      timeZone: 'Europe/Riga', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(startsAt);
    bot.telegram
      .sendMessage(process.env.ADMIN_CHAT_ID, `Jauns pieraksts (lapa): ${service.name} · ${when} · ${name} · ${phone}`)
      .catch(() => {});
  } catch {
    // TELEGRAM_BOT_TOKEN missing/invalid — ignore, the booking itself already succeeded.
  }
}

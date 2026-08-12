const { query, getPool } = require('./db');

const TZ = 'Europe/Riga';
const WORK_START_MIN = 9 * 60;  // 09:00
const WORK_END_MIN   = 19 * 60; // 19:00
const SLOT_STEP_MIN  = 15;
const HORIZON_DAYS   = 14;

function zonedTimeToUtc(dateStr, hh, mm, timeZone) {
  const asUtcGuess = new Date(`${dateStr}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00Z`);
  const tzRead  = new Date(asUtcGuess.toLocaleString('en-US', { timeZone }));
  const utcRead = new Date(asUtcGuess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(asUtcGuess.getTime() + (utcRead.getTime() - tzRead.getTime()));
}

function localDateStr(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function roundUpToStep(date, stepMin) {
  const ms = stepMin * 60000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

// ── Services ──────────────────────────────────────────────────────────────────

async function getServices() {
  const { rows } = await query('SELECT * FROM services WHERE active ORDER BY sort_order, id');
  return rows;
}

async function getService(id) {
  const { rows } = await query('SELECT * FROM services WHERE id = $1', [id]);
  return rows[0] || null;
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

// ── Barbers ───────────────────────────────────────────────────────────────────

async function getActiveBarbers() {
  const { rows } = await query('SELECT * FROM barbers WHERE active ORDER BY id');
  return rows;
}

async function getActiveBarberCount() {
  try {
    const { rows } = await query('SELECT COUNT(*) AS cnt FROM barbers WHERE active');
    return Math.max(1, Number(rows[0].cnt));
  } catch {
    return 1;
  }
}

// Returns the barber id with the fewest upcoming appointments (50/50 balancing).
async function pickBarberForAssignment() {
  try {
    const { rows } = await query(
      `SELECT b.id, b.name, COUNT(a.id) AS cnt
       FROM barbers b
       LEFT JOIN appointments a ON a.barber_id = b.id AND a.status = 'confirmed' AND a.starts_at > now()
       WHERE b.active
       GROUP BY b.id, b.name
       ORDER BY cnt ASC, b.id ASC
       LIMIT 1`
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function assignBarber(appointmentId, barberId) {
  try {
    await query('UPDATE appointments SET barber_id = $1 WHERE id = $2', [barberId, appointmentId]);
  } catch {
    // barbers table may not exist yet before migration
  }
}

// ── Surcharge ─────────────────────────────────────────────────────────────────

async function calcFinalPrice(basePrice, startsAt) {
  const settings = await getSettings();
  const peakStart = parseInt(settings['peak_hour_start'] || '18', 10);
  const peakPct   = parseFloat(settings['peak_surcharge_pct'] || '0');
  const sameDayPct = parseFloat(settings['same_day_surcharge_pct'] || '0');

  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(startsAt),
    10
  );
  const todayStr = localDateStr(new Date(), TZ);
  const slotDay  = localDateStr(startsAt, TZ);
  const isToday  = todayStr === slotDay;

  let price = basePrice;
  if (peakPct > 0 && localHour >= peakStart) price = price * (1 + peakPct / 100);
  if (sameDayPct > 0 && isToday) price = price * (1 + sameDayPct / 100);
  return Math.round(price * 100) / 100;
}

// ── Appointments ──────────────────────────────────────────────────────────────

async function getActiveAppointmentsBetween(from, to) {
  const { rows } = await query(
    `SELECT * FROM appointments
     WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1
     ORDER BY starts_at`,
    [from, to]
  );
  return rows;
}

// Finds the earliest slot where at least one barber is free.
async function findNextQueueSlot(durationMin) {
  const now        = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86400000);
  const appts      = await getActiveAppointmentsBetween(now, horizonEnd);
  const capacity   = await getActiveBarberCount();
  const todayStr   = localDateStr(now, TZ);

  for (let i = 0; i < HORIZON_DAYS; i++) {
    const dateStr  = addDays(todayStr, i);
    const dayStart = zonedTimeToUtc(dateStr, Math.floor(WORK_START_MIN / 60), WORK_START_MIN % 60, TZ);
    const dayEnd   = zonedTimeToUtc(dateStr, Math.floor(WORK_END_MIN / 60),   WORK_END_MIN % 60,   TZ);
    if (dayEnd <= now) continue;

    let cursor = dayStart > now ? dayStart : roundUpToStep(now, SLOT_STEP_MIN);
    const dayAppts = appts.filter(a => a.starts_at < dayEnd && a.ends_at > dayStart);

    while (cursor.getTime() + durationMin * 60000 <= dayEnd.getTime()) {
      const slotEnd = new Date(cursor.getTime() + durationMin * 60000);
      const overlaps = dayAppts.filter(a => cursor < new Date(a.ends_at) && slotEnd > new Date(a.starts_at)).length;
      if (overlaps < capacity) return cursor;
      cursor = new Date(cursor.getTime() + SLOT_STEP_MIN * 60000);
    }
  }
  return null;
}

async function getAvailableSlots(dateStr, durationMin) {
  const now      = new Date();
  const dayStart = zonedTimeToUtc(dateStr, Math.floor(WORK_START_MIN / 60), WORK_START_MIN % 60, TZ);
  const dayEnd   = zonedTimeToUtc(dateStr, Math.floor(WORK_END_MIN / 60),   WORK_END_MIN % 60,   TZ);
  if (dayEnd <= now) return [];

  const appts    = await getActiveAppointmentsBetween(dayStart, dayEnd);
  const capacity = await getActiveBarberCount();
  let cursor     = dayStart > now ? dayStart : roundUpToStep(now, SLOT_STEP_MIN);
  const slots    = [];

  while (cursor.getTime() + durationMin * 60000 <= dayEnd.getTime()) {
    const slotEnd  = new Date(cursor.getTime() + durationMin * 60000);
    const overlaps = appts.filter(a => cursor < new Date(a.ends_at) && slotEnd > new Date(a.starts_at)).length;
    if (overlaps < capacity) slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + SLOT_STEP_MIN * 60000);
  }
  return slots;
}

async function createAppointment({ serviceId, startsAt, endsAt, clientName, telegramUserId, telegramUsername, phone, source, mode, finalPriceEur }) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE appointments IN SHARE ROW EXCLUSIVE MODE');

    const capacity = await getActiveBarberCount();
    const overlap  = await client.query(
      `SELECT COUNT(*) AS cnt FROM appointments WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1`,
      [startsAt, endsAt]
    );
    if (Number(overlap.rows[0].cnt) >= capacity) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'taken' };
    }

    const { rows } = await client.query(
      `INSERT INTO appointments
         (service_id, starts_at, ends_at, client_name, telegram_user_id, telegram_username, phone, source, mode, final_price_eur)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [serviceId, startsAt, endsAt, clientName, telegramUserId||null, telegramUsername||null, phone||null, source||'web', mode, finalPriceEur||null]
    );
    await client.query('COMMIT');

    // Auto-assign barber outside the lock
    const barber = await pickBarberForAssignment();
    if (barber) await assignBarber(rows[0].id, barber.id);

    return { ok: true, appointment: { ...rows[0], barber } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cancelAppointment(id) {
  const { rows } = await query(
    `UPDATE appointments SET status = 'cancelled' WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function getUpcomingForUser(telegramUserId) {
  const { rows } = await query(
    `SELECT a.*, s.name AS service_name FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.telegram_user_id = $1 AND a.status = 'confirmed' AND a.ends_at > now()
     ORDER BY a.starts_at`,
    [telegramUserId]
  );
  return rows;
}

module.exports = {
  TZ, WORK_START_MIN, WORK_END_MIN,
  zonedTimeToUtc, localDateStr, addDays,
  getServices, getService,
  getSettings, setSetting,
  getActiveBarbers, getActiveBarberCount, pickBarberForAssignment, assignBarber,
  calcFinalPrice,
  findNextQueueSlot, getAvailableSlots,
  createAppointment, cancelAppointment, getUpcomingForUser,
  getActiveAppointmentsBetween,
};

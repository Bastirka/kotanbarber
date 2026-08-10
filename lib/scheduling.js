const { query, getPool } = require('./db');

const TZ = 'Europe/Riga';
const WORK_START_MIN = 9 * 60; // 09:00
const WORK_END_MIN = 19 * 60; // 19:00
const SLOT_STEP_MIN = 15;
const HORIZON_DAYS = 14;

// Converts a Y-M-D + H:M wall-clock time *in `timeZone`* into a real UTC Date.
// Handles DST correctly by measuring the zone's offset at that instant.
function zonedTimeToUtc(dateStr, hh, mm, timeZone) {
  const asUtcGuess = new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const tzRead = new Date(asUtcGuess.toLocaleString('en-US', { timeZone }));
  const utcRead = new Date(asUtcGuess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = utcRead.getTime() - tzRead.getTime();
  return new Date(asUtcGuess.getTime() + offsetMs);
}

function localDateStr(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
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

async function getServices() {
  const { rows } = await query('SELECT * FROM services WHERE active ORDER BY sort_order, id');
  return rows;
}

async function getService(id) {
  const { rows } = await query('SELECT * FROM services WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getActiveAppointmentsBetween(from, to) {
  const { rows } = await query(
    `SELECT * FROM appointments
     WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1
     ORDER BY starts_at`,
    [from, to]
  );
  return rows;
}

// Earliest-fit: walks forward from `now`, packing the new appointment into the
// first gap that's free — right after the previous booking, or into an earlier
// gap freed by a cancellation. Never leaves a gap it could have filled.
async function findNextQueueSlot(durationMin) {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86400000);
  const appts = await getActiveAppointmentsBetween(now, horizonEnd);

  let todayStr = localDateStr(now, TZ);
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const dateStr = addDays(todayStr, i);
    const dayStart = zonedTimeToUtc(dateStr, Math.floor(WORK_START_MIN / 60), WORK_START_MIN % 60, TZ);
    const dayEnd = zonedTimeToUtc(dateStr, Math.floor(WORK_END_MIN / 60), WORK_END_MIN % 60, TZ);
    if (dayEnd <= now) continue;

    let cursor = dayStart > now ? dayStart : roundUpToStep(now, SLOT_STEP_MIN);
    const dayAppts = appts.filter((a) => a.starts_at < dayEnd && a.ends_at > dayStart);

    for (const a of dayAppts) {
      const apptStart = new Date(a.starts_at);
      const apptEnd = new Date(a.ends_at);
      if (cursor.getTime() + durationMin * 60000 <= apptStart.getTime()) break;
      if (apptEnd > cursor) cursor = apptEnd;
    }

    if (cursor.getTime() + durationMin * 60000 <= dayEnd.getTime()) {
      return cursor;
    }
  }
  return null;
}

async function getAvailableSlots(dateStr, durationMin) {
  const now = new Date();
  const dayStart = zonedTimeToUtc(dateStr, Math.floor(WORK_START_MIN / 60), WORK_START_MIN % 60, TZ);
  const dayEnd = zonedTimeToUtc(dateStr, Math.floor(WORK_END_MIN / 60), WORK_END_MIN % 60, TZ);
  if (dayEnd <= now) return [];

  const appts = await getActiveAppointmentsBetween(dayStart, dayEnd);
  let cursor = dayStart > now ? dayStart : roundUpToStep(now, SLOT_STEP_MIN);

  const slots = [];
  while (cursor.getTime() + durationMin * 60000 <= dayEnd.getTime()) {
    const slotEnd = new Date(cursor.getTime() + durationMin * 60000);
    const overlaps = appts.some((a) => cursor < new Date(a.ends_at) && slotEnd > new Date(a.starts_at));
    if (!overlaps) slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + SLOT_STEP_MIN * 60000);
  }
  return slots;
}

// Locks the table for the duration of the check+insert so two clients can't
// grab the same slot at once. Fine at this shop's scale (single chair).
async function createAppointment({ serviceId, startsAt, endsAt, clientName, telegramUserId, telegramUsername, phone, source, mode }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE appointments IN SHARE ROW EXCLUSIVE MODE');
    const overlap = await client.query(
      `SELECT id FROM appointments WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1 LIMIT 1`,
      [startsAt, endsAt]
    );
    if (overlap.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'taken' };
    }
    const { rows } = await client.query(
      `INSERT INTO appointments (service_id, starts_at, ends_at, client_name, telegram_user_id, telegram_username, phone, source, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [serviceId, startsAt, endsAt, clientName, telegramUserId || null, telegramUsername || null, phone || null, source || 'web', mode]
    );
    await client.query('COMMIT');
    return { ok: true, appointment: rows[0] };
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
  TZ,
  WORK_START_MIN,
  WORK_END_MIN,
  zonedTimeToUtc,
  localDateStr,
  addDays,
  getServices,
  getService,
  findNextQueueSlot,
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  getUpcomingForUser,
  getActiveAppointmentsBetween,
};

const { getService, createAppointment } = require('../../lib/scheduling');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const header = req.headers['x-admin-token'];
  return header && header === token;
}

// Lets the barber log an appointment that already exists outside the system
// (walk-ins, phone bookings made before this went live, etc.) so the bot and
// the on-site widget stop offering that slot to new clients.
module.exports = async (req, res) => {
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const serviceId = Number(body.serviceId);
  const startsAt = new Date(body.startsAt);
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim().slice(0, 100) : '';

  if (!serviceId || !body.startsAt || Number.isNaN(startsAt.getTime())) {
    res.status(400).json({ error: 'Missing or invalid serviceId/startsAt' });
    return;
  }
  if (!clientName) {
    res.status(400).json({ error: 'Missing clientName' });
    return;
  }

  const service = await getService(serviceId);
  if (!service) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }

  const endsAt = new Date(startsAt.getTime() + service.duration_min * 60000);
  const result = await createAppointment({
    serviceId,
    startsAt,
    endsAt,
    clientName,
    phone: typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : null,
    source: 'manual',
    mode: 'scheduled',
  });

  if (!result.ok) {
    res.status(409).json({ error: 'Šis laiks jau aizņemts' });
    return;
  }

  res.status(200).json({ appointment: result.appointment });
};

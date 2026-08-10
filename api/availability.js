const { getService, findNextQueueSlot, getAvailableSlots } = require('../lib/scheduling');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const serviceId = Number(req.query.serviceId);
  if (!serviceId) {
    res.status(400).json({ error: 'Missing serviceId' });
    return;
  }
  const service = await getService(serviceId);
  if (!service) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }

  if (req.query.mode === 'queue') {
    const slot = await findNextQueueSlot(service.duration_min);
    res.status(200).json({ slot: slot ? slot.toISOString() : null });
    return;
  }

  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Missing or invalid date (YYYY-MM-DD)' });
    return;
  }
  const slots = await getAvailableSlots(date, service.duration_min);
  res.status(200).json({ slots: slots.map((s) => s.toISOString()) });
};

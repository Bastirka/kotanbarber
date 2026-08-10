const { cancelAppointment } = require('../../lib/scheduling');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const header = req.headers['x-admin-token'];
  return header && header === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const id = Number(req.body && req.body.id);
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  const appt = await cancelAppointment(id);
  if (!appt) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(200).json({ appointment: appt });
};

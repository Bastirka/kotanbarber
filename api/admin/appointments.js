const { query } = require('../../lib/db');

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
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const from = req.query.from || new Date().toISOString();
  const days = Math.min(Number(req.query.days) || 7, 31);
  const to = new Date(new Date(from).getTime() + days * 86400000).toISOString();

  const { rows } = await query(
    `SELECT a.id, a.starts_at, a.ends_at, a.client_name, a.telegram_username, a.mode, a.status,
            s.name AS service_name, s.price_eur
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.starts_at >= $1 AND a.starts_at < $2 AND a.status = 'confirmed'
     ORDER BY a.starts_at`,
    [from, to]
  );
  res.status(200).json({ appointments: rows });
};

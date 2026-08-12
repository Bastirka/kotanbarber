const { query } = require('../../lib/db');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { id, barberId } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  await query(
    'UPDATE appointments SET barber_id = $1 WHERE id = $2',
    [barberId || null, id]
  );
  res.status(200).json({ ok: true });
};

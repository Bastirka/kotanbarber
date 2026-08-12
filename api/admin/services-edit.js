const { query } = require('../../lib/db');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  if (req.method === 'GET') {
    const { rows } = await query('SELECT * FROM services ORDER BY sort_order, id');
    return res.status(200).json({ services: rows });
  }

  if (req.method === 'PATCH') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { price_eur, duration_min, name, active } = req.body || {};
    const { rows } = await query(
      `UPDATE services SET
        price_eur    = COALESCE($1, price_eur),
        duration_min = COALESCE($2, duration_min),
        name         = COALESCE($3, name),
        active       = COALESCE($4, active)
       WHERE id = $5 RETURNING *`,
      [price_eur !== undefined ? Number(price_eur) : null,
       duration_min !== undefined ? Number(duration_min) : null,
       name || null,
       active !== undefined ? active : null,
       id]
    );
    return res.status(200).json({ service: rows[0] });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

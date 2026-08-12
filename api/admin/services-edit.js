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

  if (req.method === 'POST') {
    const { name, price_eur, duration_min } = req.body || {};
    if (!name || !price_eur || !duration_min) return res.status(400).json({ error: 'name, price_eur, duration_min required' });
    const { rows: existing } = await query('SELECT MAX(sort_order) AS mx FROM services');
    const sortOrder = (existing[0].mx || 0) + 1;
    const { rows } = await query(
      `INSERT INTO services (name, price_eur, duration_min, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), Number(price_eur), Number(duration_min), sortOrder]
    );
    return res.status(201).json({ service: rows[0] });
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

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { rows } = await query(
      `SELECT COUNT(*) AS cnt FROM appointments WHERE service_id = $1 AND status = 'confirmed' AND starts_at > now()`,
      [id]
    );
    if (Number(rows[0].cnt) > 0) return res.status(409).json({ error: 'Ir aktīvi pieraksti šim pakalpojumam — vispirms atcel tos.' });
    await query('DELETE FROM services WHERE id = $1', [id]);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

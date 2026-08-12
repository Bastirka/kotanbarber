const { query } = require('../../lib/db');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  if (req.method === 'GET') {
    const { rows } = await query('SELECT * FROM gallery_images ORDER BY sort_order, id');
    return res.status(200).json({ images: rows });
  }

  if (req.method === 'POST') {
    const { url, label } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    const { rows: mx } = await query('SELECT MAX(sort_order) AS m FROM gallery_images');
    const { rows } = await query(
      'INSERT INTO gallery_images (url, label, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [url.trim(), (label||'').trim(), (mx[0].m||0)+1]
    );
    return res.status(201).json({ image: rows[0] });
  }

  if (req.method === 'PATCH') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { url, label, sort_order, active } = req.body || {};
    const { rows } = await query(
      `UPDATE gallery_images SET
        url        = COALESCE($1, url),
        label      = COALESCE($2, label),
        sort_order = COALESCE($3, sort_order),
        active     = COALESCE($4, active)
       WHERE id = $5 RETURNING *`,
      [url||null, label!==undefined?label:null, sort_order!==undefined?Number(sort_order):null, active!==undefined?active:null, id]
    );
    return res.status(200).json({ image: rows[0] });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    await query('DELETE FROM gallery_images WHERE id = $1', [id]);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

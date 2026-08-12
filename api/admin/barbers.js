const { query } = require('../../lib/db');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  // Ensure color column exists
  await query(`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#d92b3a'`).catch(()=>{});

  if (req.method === 'GET') {
    const { rows } = await query('SELECT * FROM barbers ORDER BY id');
    return res.status(200).json({ barbers: rows });
  }

  if (req.method === 'POST') {
    const { name, telegram_chat_id, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await query(
      'INSERT INTO barbers (name, telegram_chat_id, color) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), telegram_chat_id || null, color || '#d92b3a']
    );
    return res.status(201).json({ barber: rows[0] });
  }

  if (req.method === 'PATCH') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { name, telegram_chat_id, active, color } = req.body || {};
    const { rows } = await query(
      `UPDATE barbers SET
        name             = COALESCE($1, name),
        telegram_chat_id = COALESCE($2, telegram_chat_id),
        active           = COALESCE($3, active),
        color            = COALESCE($4, color)
       WHERE id = $5 RETURNING *`,
      [name || null, telegram_chat_id !== undefined ? (telegram_chat_id || null) : null, active !== undefined ? active : null, color || null, id]
    );
    return res.status(200).json({ barber: rows[0] });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    await query('UPDATE barbers SET active = false WHERE id = $1', [id]);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

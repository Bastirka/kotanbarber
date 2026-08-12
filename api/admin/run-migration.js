const fs = require('fs');
const path = require('path');
const { getPool } = require('../../lib/db');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const sql = fs.readFileSync(path.join(process.cwd(), 'sql', 'schema.sql'), 'utf8');
    const pool = getPool();
    await pool.query(sql);
    res.status(200).json({ ok: true, message: 'Migration applied.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

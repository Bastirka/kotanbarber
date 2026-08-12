const { query } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const { rows } = await query('SELECT id, url, label, sort_order FROM gallery_images WHERE active ORDER BY sort_order, id');
    res.status(200).json({ images: rows });
  } catch {
    res.status(200).json({ images: [] });
  }
};

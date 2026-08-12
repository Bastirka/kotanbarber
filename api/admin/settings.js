const { getSettings, setSetting } = require('../../lib/scheduling');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  if (req.method === 'GET') {
    const settings = await getSettings();
    return res.status(200).json({ settings });
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const body = req.body || {};
    for (const [key, value] of Object.entries(body)) {
      await setSetting(key, value);
    }
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

const { query } = require('../../lib/db');
const { put } = require('@vercel/blob');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS gallery_images (
      id         SERIAL PRIMARY KEY,
      url        TEXT NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      const boundaryMatch = ct.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) return reject(new Error('No boundary'));
      const boundary = '--' + boundaryMatch[1];
      const parts = raw.toString('binary').split(boundary).slice(1, -1);
      const result = { fields: {}, file: null };
      for (const part of parts) {
        const [headerSection, ...bodyParts] = part.split('\r\n\r\n');
        const body = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '');
        const cdMatch = headerSection.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
        const fnMatch = headerSection.match(/filename="([^"]+)"/i);
        if (!cdMatch) continue;
        const name = cdMatch[1];
        if (fnMatch) {
          const ctMatch = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
          result.file = {
            name: fnMatch[1],
            type: (ctMatch && ctMatch[1].trim()) || 'image/jpeg',
            buffer: Buffer.from(body, 'binary'),
          };
        } else {
          result.fields[name] = body;
        }
      }
      resolve(result);
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (!checkAuth(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
  await ensureTable();

  if (req.method === 'GET') {
    const { rows } = await query('SELECT * FROM gallery_images ORDER BY sort_order, id');
    return res.status(200).json({ images: rows });
  }

  if (req.method === 'POST') {
    const ct = req.headers['content-type'] || '';

    // Multipart file upload (XHR FormData)
    if (ct.includes('multipart/form-data')) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(503).json({ error: 'Blob storage nav iestatīts.' });
      }
      const { fields, file } = await parseMultipart(req);
      if (!file) return res.status(400).json({ error: 'Nav faila' });
      const blob = await put(file.name, file.buffer, { access: 'public', contentType: file.type, addRandomSuffix: false });
      const label = (fields.label || '').trim();
      const { rows: mx } = await query('SELECT MAX(sort_order) AS m FROM gallery_images');
      const { rows } = await query(
        'INSERT INTO gallery_images (url, label, sort_order) VALUES ($1,$2,$3) RETURNING *',
        [blob.url, label, (mx[0].m || 0) + 1]
      );
      return res.status(201).json({ image: rows[0] });
    }

    // JSON upload (URL or base64)
    const { url, label, fileData, fileName, fileType } = req.body || {};
    let finalUrl = url;
    if (fileData && fileName) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(503).json({ error: 'Blob storage nav iestatīts.' });
      }
      const buffer = Buffer.from(fileData, 'base64');
      const ext = (fileType || 'image/jpeg').split('/')[1] || 'jpg';
      const safeName = `gallery/${Date.now()}.${ext}`;
      const blob = await put(safeName, buffer, { access: 'public', contentType: fileType || 'image/jpeg', addRandomSuffix: false });
      finalUrl = blob.url;
    }
    if (!finalUrl) return res.status(400).json({ error: 'url vai fails nepieciešams' });
    const { rows: mx } = await query('SELECT MAX(sort_order) AS m FROM gallery_images');
    const { rows } = await query(
      'INSERT INTO gallery_images (url, label, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [finalUrl.trim(), (label||'').trim(), (mx[0].m||0)+1]
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

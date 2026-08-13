const { put } = require('@vercel/blob');
const { query } = require('../../lib/db');

function checkAuth(req) {
  const token = process.env.ADMIN_TOKEN;
  return token && req.headers['x-admin-token'] === token;
}

// Parse multipart/form-data manually — Vercel provides raw body as Buffer
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
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Blob storage nav iestatīts.' });
  }

  try {
    const { fields, file } = await parseMultipart(req);
    if (!file) return res.status(400).json({ error: 'Nav faila' });

    const blob = await put(file.name, file.buffer, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    });

    const label = (fields.label || '').trim();
    const { rows: mx } = await query('SELECT MAX(sort_order) AS m FROM gallery_images');
    const { rows } = await query(
      'INSERT INTO gallery_images (url, label, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [blob.url, label, (mx[0].m || 0) + 1]
    );

    res.status(201).json({ image: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

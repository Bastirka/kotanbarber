const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running the migration.');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  await pool.query(sql);
  await pool.end();
  console.log('Schema applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

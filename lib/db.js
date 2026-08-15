const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

module.exports = { getPool, query };

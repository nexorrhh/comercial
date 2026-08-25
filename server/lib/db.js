// Pool de conexión a la base Postgres de Supabase. El schema (server/lib/schema.sql)
// se aplica una sola vez a mano desde el SQL Editor de Supabase (ver README) —
// a diferencia de la versión SQLite anterior, acá no se auto-ejecuta en cada
// arranque, porque en un entorno serverless (Vercel) cada cold start dispararía
// la migración en paralelo con otros arranques.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta la variable de entorno DATABASE_URL (connection string de Supabase)');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

// Para transacciones (BEGIN/COMMIT) hace falta el mismo client en todas las
// consultas de la transacción, así que se expone getClient() además de query().
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };

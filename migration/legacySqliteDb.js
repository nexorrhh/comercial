// Conexión standalone a la vieja base SQLite (data/cotizaciones.db), separada
// a propósito de server/lib/db.js (que desde la migración a Supabase apunta a
// Postgres). La usan sólo los scripts de este directorio que todavía trabajan
// sobre datos ya cargados en SQLite: import_excel.js e inferir_modo_envio.js
// (históricos, del sistema previo a Supabase) y migrate_to_supabase.js (que
// lee de acá para volcar todo a Supabase).
//
// Usa el módulo "node:sqlite" incluido en Node.js (22+) en vez de
// better-sqlite3, para no depender de un compilador nativo (Visual Studio /
// build-essential) sólo para estos scripts puntuales. La API (.prepare().get/
// all/run(), parámetros con @nombre, .exec() para DDL) es la misma.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.LEGACY_DB_PATH || path.join(__dirname, '..', 'data', 'cotizaciones.db');
const db = new DatabaseSync(DB_PATH);

// Idempotente (CREATE TABLE IF NOT EXISTS): si el archivo ya tiene el schema
// cargado (caso normal, es la base de producción de antes de migrar) esto no
// hace nada; si se corre contra un archivo nuevo/vacío, lo deja listo.
const schema = fs.readFileSync(path.join(__dirname, 'legacy_schema_sqlite.sql'), 'utf8');
db.exec(schema);

module.exports = db;

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'cotizaciones.db');
const db = new Database(DB_PATH);

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// --- Auto-migración segura para bases de datos ya existentes ---
// "CREATE TABLE IF NOT EXISTS" (arriba) no le agrega columnas nuevas a una tabla
// que ya existía de una versión anterior del sistema (como la del usuario, ya
// cargada con datos reales). Por eso cada columna nueva se agrega a mano con
// ALTER TABLE, sólo si todavía no está — así una base nueva y una base vieja
// terminan con el mismo esquema, sin tocar ni una fila de datos existente.
function columnasActuales(tabla) {
  return new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
}

function agregarColumnaSiFalta(tabla, columna, definicionSql) {
  if (!columnasActuales(tabla).has(columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${definicionSql}`);
  }
}

// Agregado en la Actualización 2 (modo de envío / "Cotiza por" desde Actualización 3)
agregarColumnaSiFalta('cotizaciones', 'modo_entrega_id', 'modo_entrega_id INTEGER REFERENCES catalogo_modo_entrega(id)');

// Agregados en la Actualización 3
agregarColumnaSiFalta('cotizaciones', 'monto_cotizado', 'monto_cotizado REAL');
agregarColumnaSiFalta('cotizaciones', 'monto_adjudicado', 'monto_adjudicado REAL');
agregarColumnaSiFalta('cotizaciones', 'moneda', 'moneda TEXT');
agregarColumnaSiFalta('cotizaciones', 'tipo_cotizacion', 'tipo_cotizacion TEXT');
agregarColumnaSiFalta('cotizaciones', 'hora_cierre', 'hora_cierre TEXT');

// Agregado en la Actualización 4
agregarColumnaSiFalta('cotizaciones', 'contacto_comprador', 'contacto_comprador TEXT');

// Agregados en la Actualización 5 (revisiones)
agregarColumnaSiFalta('cotizaciones', 'revision', 'revision INTEGER NOT NULL DEFAULT 0');
agregarColumnaSiFalta('cotizaciones', 'motivo_revision', 'motivo_revision TEXT');
agregarColumnaSiFalta('cotizaciones', 'cotizacion_original_id', 'cotizacion_original_id INTEGER REFERENCES cotizaciones(id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_cotizaciones_original ON cotizaciones(cotizacion_original_id)');

// Agregado en la Actualización 11: "% mayor costo" (markup sobre el costo)
agregarColumnaSiFalta('cotizaciones', 'porcentaje_mayor_costo', 'porcentaje_mayor_costo REAL');

// Semilla mínima de catálogos de ESTADO (fijos, no dependen de la limpieza de datos)
const estadoSeed = db.prepare(
  'INSERT OR IGNORE INTO catalogo_estado (codigo, nombre) VALUES (?, ?)'
);
const estados = [
  ['C', 'Cotizado'],
  ['NC', 'No cotizamos'],
  ['P', 'Pendiente'],
];
const insertEstados = db.transaction((rows) => {
  for (const [codigo, nombre] of rows) estadoSeed.run(codigo, nombre);
});
insertEstados(estados);

// Semilla mínima de catálogo de MODO DE ENTREGA ("Cotiza por"): Mail / Portal / Otro
const modoEntregaSeed = db.prepare(
  'INSERT OR IGNORE INTO catalogo_modo_entrega (nombre) VALUES (?)'
);
const insertModosEntrega = db.transaction((nombres) => {
  for (const nombre of nombres) modoEntregaSeed.run(nombre);
});
insertModosEntrega(['Mail', 'Portal', 'Otro']);

// Actualización 4: renombrar la etiqueta del estado "NC" de "No cotizado" a
// "No cotizamos". INSERT OR IGNORE (arriba) no toca una fila que ya existe,
// así que en una base ya instalada hace falta este UPDATE aparte. Es
// idempotente: sólo pisa el nombre viejo exacto, así que correrlo de nuevo
// (o correrlo en una base que ya tiene el nombre nuevo) no hace nada.
db.prepare("UPDATE catalogo_estado SET nombre = 'No cotizamos' WHERE codigo = 'NC' AND nombre = 'No cotizado'").run();

module.exports = db;

// Migra los datos de la vieja base SQLite (data/cotizaciones.db) a Supabase
// (Postgres + Auth). Correr UNA SOLA VEZ, después de:
//   1. Crear el proyecto de Supabase y correr server/lib/schema.sql en el SQL Editor.
//   2. Completar en .env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Uso:
//   node migration/migrate_to_supabase.js [--dominio=tuempresa.com]
//
// --dominio se usa sólo para los usuarios viejos cuyo "username" no sea ya un
// email (ej. "jperez" -> "jperez@tuempresa.com"). Por defecto usa
// "cimomet.local" (dominio que no resuelve de verdad — sirve para que
// Supabase Auth acepte la cuenta, pero esa persona no va a poder loguearse
// hasta que un admin le cambie el email/contraseña reales desde /admin).
//
// Cada usuario migrado recibe una contraseña provisoria aleatoria (queda en
// el reporte final, data/reporte_migracion_supabase.json) — avisarle a cada
// uno para que la cambie, o cambiarla desde /admin.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const legacyDb = require('./legacySqliteDb');
const db = require('../server/lib/db');
const supabaseAdmin = require('../server/lib/supabaseAdmin');

const dominioArg = process.argv.find((a) => a.startsWith('--dominio='));
const DOMINIO_FALLBACK = dominioArg ? dominioArg.split('=')[1] : 'cimomet.local';

function passwordProvisoria() {
  return crypto.randomBytes(9).toString('base64url');
}

function emailParaUsername(username) {
  return username.includes('@') ? username : `${username}@${DOMINIO_FALLBACK}`;
}

async function migrarUsuarios() {
  const usuarios = legacyDb.prepare('SELECT * FROM usuarios ORDER BY id').all();
  const mapaIds = new Map(); // id numérico viejo -> uuid nuevo
  const credenciales = [];

  for (const u of usuarios) {
    const email = emailParaUsername(u.username);
    const password = passwordProvisoria();

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.error(`No se pudo crear en Auth el usuario "${u.username}" (${email}):`, error.message);
      continue;
    }

    await db.query(
      `INSERT INTO perfiles (id, email, nombre_completo, rol, activo, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.user.id, email, u.nombre_completo, u.rol, Boolean(u.activo), u.creado_en],
    );

    mapaIds.set(u.id, data.user.id);
    credenciales.push({ username_viejo: u.username, email, password_provisoria: password, rol: u.rol });
  }

  console.log(`Usuarios migrados: ${mapaIds.size} / ${usuarios.length}`);
  return { mapaIds, credenciales };
}

async function migrarCatalogo(tabla, columnas) {
  const filas = legacyDb.prepare(`SELECT * FROM ${tabla} ORDER BY id`).all();
  for (const f of filas) {
    const valores = columnas.map((c) => f[c]);
    const placeholders = columnas.map((_, i) => `$${i + 2}`).join(', ');
    await db.query(
      `INSERT INTO ${tabla} (id, ${columnas.join(', ')}) VALUES ($1, ${placeholders})
       ON CONFLICT (id) DO NOTHING`,
      [f.id, ...valores],
    );
  }
  if (filas.length > 0) {
    await db.query(`SELECT setval(pg_get_serial_sequence('${tabla}', 'id'), (SELECT MAX(id) FROM ${tabla}))`);
  }
  console.log(`${tabla}: ${filas.length} filas`);
  return filas.length;
}

async function migrarCotizaciones(mapaIds) {
  const filas = legacyDb.prepare('SELECT * FROM cotizaciones ORDER BY id').all();
  const columnas = [
    'fecha_recepcion', 'nombre', 'cliente', 'fecha_limite', 'cotizador_id', 'observaciones',
    'comprador', 'contacto_comprador', 'estado_id', 'adjudicado', 'numero_oferta', 'ot',
    'toneladas', 'toneladas_ejecutadas', 'categoria_id', 'responsable_comercial_id',
    'modo_entrega_id', 'monto_cotizado', 'monto_adjudicado', 'moneda', 'tipo_cotizacion',
    'hora_cierre', 'porcentaje_mayor_costo', 'revision', 'motivo_revision',
    'cotizacion_original_id', 'creado_por_id', 'creado_en', 'actualizado_por_id',
    'actualizado_en', 'origen',
  ];

  for (const f of filas) {
    const valores = columnas.map((c) => {
      if (c === 'responsable_comercial_id' || c === 'creado_por_id' || c === 'actualizado_por_id') {
        return f[c] == null ? null : mapaIds.get(f[c]) || null;
      }
      return f[c];
    });
    const placeholders = columnas.map((_, i) => `$${i + 2}`).join(', ');
    await db.query(
      `INSERT INTO cotizaciones (id, ${columnas.join(', ')}) VALUES ($1, ${placeholders})
       ON CONFLICT (id) DO NOTHING`,
      [f.id, ...valores],
    );
  }
  if (filas.length > 0) {
    await db.query("SELECT setval(pg_get_serial_sequence('cotizaciones', 'id'), (SELECT MAX(id) FROM cotizaciones))");
  }
  console.log(`cotizaciones: ${filas.length} filas`);
  return filas.length;
}

async function migrarHistorialYAccesos(mapaIds) {
  const historial = legacyDb.prepare('SELECT * FROM historial_cambios ORDER BY id').all();
  for (const h of historial) {
    await db.query(
      `INSERT INTO historial_cambios (id, cotizacion_id, usuario_id, campo, valor_anterior, valor_nuevo, accion, fecha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [h.id, h.cotizacion_id, h.usuario_id == null ? null : mapaIds.get(h.usuario_id) || null,
        h.campo, h.valor_anterior, h.valor_nuevo, h.accion, h.fecha],
    );
  }
  if (historial.length > 0) {
    await db.query("SELECT setval(pg_get_serial_sequence('historial_cambios', 'id'), (SELECT MAX(id) FROM historial_cambios))");
  }
  console.log(`historial_cambios: ${historial.length} filas`);

  const accesos = legacyDb.prepare('SELECT * FROM log_accesos ORDER BY id').all();
  for (const a of accesos) {
    await db.query(
      `INSERT INTO log_accesos (id, usuario_id, fecha, exito, ip) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.usuario_id == null ? null : mapaIds.get(a.usuario_id) || null, a.fecha, a.exito, a.ip],
    );
  }
  if (accesos.length > 0) {
    await db.query("SELECT setval(pg_get_serial_sequence('log_accesos', 'id'), (SELECT MAX(id) FROM log_accesos))");
  }
  console.log(`log_accesos: ${accesos.length} filas`);

  return { historial: historial.length, accesos: accesos.length };
}

async function main() {
  console.log('--- Migrando usuarios a Supabase Auth + perfiles ---');
  const { mapaIds, credenciales } = await migrarUsuarios();

  console.log('--- Migrando catálogos ---');
  const conteos = {};
  conteos.categorias = await migrarCatalogo('catalogo_categoria', ['nombre', 'activo']);
  conteos.estados = await migrarCatalogo('catalogo_estado', ['codigo', 'nombre']);
  conteos.cotizadores = await migrarCatalogo('catalogo_cotizador', ['iniciales', 'nombre_completo', 'activo']);
  conteos.modos_entrega = await migrarCatalogo('catalogo_modo_entrega', ['nombre']);

  console.log('--- Migrando cotizaciones ---');
  conteos.cotizaciones = await migrarCotizaciones(mapaIds);

  console.log('--- Migrando historial y accesos ---');
  const { historial, accesos } = await migrarHistorialYAccesos(mapaIds);
  conteos.historial_cambios = historial;
  conteos.log_accesos = accesos;

  const reporte = {
    generado_en: new Date().toISOString(),
    conteos,
    usuarios_migrados: credenciales,
  };
  const rutaReporte = path.join(__dirname, '..', 'data', 'reporte_migracion_supabase.json');
  fs.writeFileSync(rutaReporte, JSON.stringify(reporte, null, 2), 'utf8');
  console.log(`\nReporte con contraseñas provisorias guardado en: ${rutaReporte}`);
  console.log('Avisale a cada usuario su contraseña provisoria (o cambiásela vos desde /admin) y borrá ese reporte cuando ya no lo necesites.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error en la migración:', err);
  process.exit(1);
});

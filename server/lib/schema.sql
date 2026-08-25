-- Esquema del sistema de cotizaciones e indicadores ISO
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre_completo TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','gerencia','comercial','lectura')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalogo_categoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);

-- codigo NC se muestra como "No cotizamos" desde la Actualización 4 (antes "No cotizado");
-- el renombre para instalaciones ya existentes lo hace un UPDATE idempotente en db.js.
CREATE TABLE IF NOT EXISTS catalogo_estado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogo_cotizador (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iniciales TEXT UNIQUE NOT NULL,
  nombre_completo TEXT,
  activo INTEGER NOT NULL DEFAULT 1
);

-- Modo de entrega de la oferta (Mail / Portal / Otro). Se muestra en el listado
-- y en la ficha con la etiqueta "Cotiza por" (agregado en la Actualización 2,
-- renombrado en la Actualización 3).
CREATE TABLE IF NOT EXISTS catalogo_modo_entrega (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL
);

-- Tabla maestra de cotizaciones (reemplaza la hoja "VersionesDeObras-proyectos")
CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_recepcion TEXT,           -- fecha ISO (YYYY-MM-DD) - RECEPCIÓN PEDIDO
  nombre TEXT NOT NULL,           -- descripción de la obra/proyecto
  cliente TEXT,                   -- razon_soci
  fecha_limite TEXT,              -- fech_limit, ISO. En la ficha se muestra como "F. Presentación" (Actualización 3)
  cotizador_id INTEGER REFERENCES catalogo_cotizador(id),
  observaciones TEXT,             -- OBS
  comprador TEXT,
  contacto_comprador TEXT,        -- Actualización 4: dato separado de "comprador", ej. contacto directo/teléfono/email
  estado_id INTEGER REFERENCES catalogo_estado(id),
  -- 0 = No, 1 = Sí, 2 = A otro proveedor (Actualización 3 agregó el valor 2;
  -- antes era estrictamente 0/1). Los indicadores ISO sólo cuentan adjudicado = 1,
  -- así que "a otro proveedor" queda correctamente afuera de "adjudicadas" sin
  -- tocar ninguna consulta existente.
  adjudicado INTEGER NOT NULL DEFAULT 0,
  numero_oferta TEXT,
  ot TEXT,
  toneladas REAL,                 -- toneladas cotizadas
  toneladas_ejecutadas REAL,       -- en la ficha se muestra como "Ton. Adjudicadas" (Actualización 3)
  categoria_id INTEGER REFERENCES catalogo_categoria(id),
  responsable_comercial_id INTEGER REFERENCES usuarios(id), -- a quién le corresponde el seguimiento
  modo_entrega_id INTEGER REFERENCES catalogo_modo_entrega(id), -- Actualización 2; etiqueta "Cotiza por" desde Actualización 3
  -- Campos agregados en la Actualización 3:
  monto_cotizado REAL,             -- Monto Cotizado
  monto_adjudicado REAL,           -- Monto Adjudicado
  moneda TEXT CHECK (moneda IS NULL OR moneda IN ('USD','ARS')),
  tipo_cotizacion TEXT CHECK (tipo_cotizacion IS NULL OR tipo_cotizacion IN ('Budget','Compra')),
  hora_cierre TEXT,                -- "HH:MM"
  -- Actualización 11: porcentaje que se agrega sobre el costo para llegar al monto
  -- cotizado (markup comercial). Numérico libre (admite decimales, ej. 12.5 = 12,5%).
  -- Mismo criterio de edición que monto_cotizado/monto_adjudicado: sólo admin/gerencia.
  porcentaje_mayor_costo REAL,
  -- Revisiones (Actualización 5): cuando el cliente vuelve con una consulta sobre
  -- una cotización ya cerrada, en vez de pisar la fila se crea una fila NUEVA con
  -- todos los datos copiados, para no perder el rastro de cuántas veces se trabajó
  -- en la misma oportunidad. "revision" arranca en 0 (carga original) y sube de a 1
  -- por cada vuelta; "cotizacion_original_id" apunta siempre a la fila de revisión 0
  -- (queda NULL en la fila original), así todas las revisiones de una misma
  -- cotización quedan agrupadas. "motivo_revision" es el texto libre que explica de
  -- qué se trató esa vuelta (ej. "Responder consultas del cliente").
  revision INTEGER NOT NULL DEFAULT 0,
  motivo_revision TEXT,
  cotizacion_original_id INTEGER REFERENCES cotizaciones(id),
  creado_por_id INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por_id INTEGER REFERENCES usuarios(id),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  origen TEXT DEFAULT 'app'       -- 'app', 'migracion_excel' o 'revision', para trazar el origen del dato
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_categoria ON cotizaciones(categoria_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_limite ON cotizaciones(fecha_limite);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_responsable ON cotizaciones(responsable_comercial_id);
-- El índice de "cotizacion_original_id" (columna de la Actualización 5) se crea
-- desde server/lib/db.js, DESPUÉS de la migración que agrega la columna — así no
-- rompe en una base ya existente que todavía no la tiene cuando se corre este
-- schema.sql completo de punta a punta.

-- Historial de cambios (auditoría) - un registro por CAMPO modificado
CREATE TABLE IF NOT EXISTS historial_cambios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id),
  campo TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  accion TEXT NOT NULL DEFAULT 'update', -- 'create' | 'update' | 'delete'
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_historial_cotizacion ON historial_cambios(cotizacion_id);

-- Registro de accesos (quién entró y cuándo) - útil para ISO también
CREATE TABLE IF NOT EXISTS log_accesos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  exito INTEGER NOT NULL DEFAULT 1,
  ip TEXT
);

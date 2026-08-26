-- Esquema del sistema de cotizaciones e indicadores ISO (Supabase / Postgres)
--
-- Todas las tablas que crea este proyecto llevan el prefijo "comercial_" para
-- convivir ordenadas con el resto de las tablas que ya existen en este mismo
-- proyecto de Supabase, sin pisar ni mezclarse con ellas.
--
-- "comercial_perfiles" reemplaza a la vieja tabla "usuarios" de SQLite: el
-- login y la contraseña ahora los maneja Supabase Auth (tabla auth.users,
-- fuera de este schema). Acá sólo se guarda el perfil de negocio (rol,
-- nombre, activo) de cada usuario ya autenticado, enlazado 1 a 1 con
-- auth.users por uuid.
CREATE TABLE IF NOT EXISTS comercial_perfiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nombre_completo TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','gerencia','comercial','lectura')),
  activo BOOLEAN NOT NULL DEFAULT true,
  -- true cuando el admin cargó el email real de la persona pero todavía no
  -- tiene contraseña propia (ej. usuarios migrados con email de relleno, a
  -- los que se les corrigió el email sin fijarles clave). Mientras esté en
  -- true, el login le pide que cree su propia contraseña en vez de pedirle
  -- una existente.
  debe_crear_password BOOLEAN NOT NULL DEFAULT false,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comercial_catalogo_categoria (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- codigo NC se muestra como "No cotizamos" (antes "No cotizado"); el
-- renombre para instalaciones ya existentes lo hace un UPDATE idempotente en
-- server/lib/db.js.
CREATE TABLE IF NOT EXISTS comercial_catalogo_estado (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comercial_catalogo_cotizador (
  id SERIAL PRIMARY KEY,
  iniciales TEXT UNIQUE NOT NULL,
  nombre_completo TEXT,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- Modo de entrega de la oferta (Mail / Portal / Otro). Se muestra en el
-- listado y en la ficha con la etiqueta "Cotiza por".
CREATE TABLE IF NOT EXISTS comercial_catalogo_modo_entrega (
  id SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL
);

-- Tabla maestra de cotizaciones. Las fechas se guardan como TEXT en formato
-- ISO (YYYY-MM-DD) a propósito -así ordenan y comparan igual que en la base
-- SQLite original, sin tener que reescribir ningún filtro de fecha.
CREATE TABLE IF NOT EXISTS comercial_cotizaciones (
  id SERIAL PRIMARY KEY,
  fecha_recepcion TEXT,           -- fecha ISO (YYYY-MM-DD) - RECEPCIÓN PEDIDO
  nombre TEXT NOT NULL,           -- descripción de la obra/proyecto
  cliente TEXT,
  fecha_limite TEXT,              -- fecha ISO. En la ficha se muestra como "F. Presentación"
  cotizador_id INTEGER REFERENCES comercial_catalogo_cotizador(id),
  observaciones TEXT,
  comprador TEXT,
  contacto_comprador TEXT,        -- dato separado de "comprador", ej. contacto directo/teléfono/email
  estado_id INTEGER REFERENCES comercial_catalogo_estado(id),
  -- 0 = No, 1 = Sí, 2 = A otro proveedor. Los indicadores ISO sólo cuentan
  -- adjudicado = 1, así que "a otro proveedor" queda correctamente afuera de
  -- "adjudicadas" sin tocar ninguna consulta.
  adjudicado INTEGER NOT NULL DEFAULT 0,
  numero_oferta TEXT,
  ot TEXT,
  toneladas REAL,                 -- toneladas cotizadas
  toneladas_ejecutadas REAL,       -- en la ficha se muestra como "Ton. Adjudicadas"
  categoria_id INTEGER REFERENCES comercial_catalogo_categoria(id),
  responsable_comercial_id UUID REFERENCES comercial_perfiles(id), -- a quién le corresponde el seguimiento
  modo_entrega_id INTEGER REFERENCES comercial_catalogo_modo_entrega(id), -- etiqueta "Cotiza por"
  monto_cotizado REAL,             -- Monto Cotizado
  monto_adjudicado REAL,           -- Monto Adjudicado
  moneda TEXT CHECK (moneda IS NULL OR moneda IN ('USD','ARS')),
  tipo_cotizacion TEXT CHECK (tipo_cotizacion IS NULL OR tipo_cotizacion IN ('Budget','Compra')),
  hora_cierre TEXT,                -- "HH:MM"
  -- Porcentaje que se agrega sobre el costo para llegar al monto cotizado
  -- (markup comercial). Numérico libre (admite decimales, ej. 12.5 = 12,5%).
  porcentaje_mayor_costo REAL,
  -- Revisiones: cuando el cliente vuelve con una consulta sobre una
  -- cotización ya cerrada, en vez de pisar la fila se crea una fila NUEVA con
  -- todos los datos copiados, para no perder el rastro de cuántas veces se
  -- trabajó en la misma oportunidad. "revision" arranca en 0 (carga
  -- original) y sube de a 1 por cada vuelta; "cotizacion_original_id" apunta
  -- siempre a la fila de revisión 0 (queda NULL en la fila original), así
  -- todas las revisiones de una misma cotización quedan agrupadas.
  -- "motivo_revision" es el texto libre que explica de qué se trató esa
  -- vuelta (ej. "Responder consultas del cliente").
  revision INTEGER NOT NULL DEFAULT 0,
  motivo_revision TEXT,
  cotizacion_original_id INTEGER REFERENCES comercial_cotizaciones(id),
  creado_por_id UUID REFERENCES comercial_perfiles(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por_id UUID REFERENCES comercial_perfiles(id),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen TEXT DEFAULT 'app'       -- 'app', 'migracion_excel', 'migracion_supabase' o 'revision'
);

CREATE INDEX IF NOT EXISTS idx_comercial_cotizaciones_categoria ON comercial_cotizaciones(categoria_id);
CREATE INDEX IF NOT EXISTS idx_comercial_cotizaciones_estado ON comercial_cotizaciones(estado_id);
CREATE INDEX IF NOT EXISTS idx_comercial_cotizaciones_fecha_limite ON comercial_cotizaciones(fecha_limite);
CREATE INDEX IF NOT EXISTS idx_comercial_cotizaciones_responsable ON comercial_cotizaciones(responsable_comercial_id);
CREATE INDEX IF NOT EXISTS idx_comercial_cotizaciones_original ON comercial_cotizaciones(cotizacion_original_id);

-- Historial de cambios (auditoría) - un registro por CAMPO modificado
CREATE TABLE IF NOT EXISTS comercial_historial_cambios (
  id SERIAL PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL REFERENCES comercial_cotizaciones(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES comercial_perfiles(id),
  campo TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  accion TEXT NOT NULL DEFAULT 'update', -- 'create' | 'update' | 'delete'
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comercial_historial_cotizacion ON comercial_historial_cambios(cotizacion_id);

-- Registro de accesos (quién entró y cuándo) - útil para ISO también
CREATE TABLE IF NOT EXISTS comercial_log_accesos (
  id SERIAL PRIMARY KEY,
  usuario_id UUID REFERENCES comercial_perfiles(id),
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  exito INTEGER NOT NULL DEFAULT 1,
  ip TEXT
);

-- Semilla mínima de catálogos fijos (no dependen de datos migrados).
-- Idempotente: correr este schema.sql más de una vez no duplica filas.
INSERT INTO comercial_catalogo_estado (codigo, nombre) VALUES
  ('C', 'Cotizado'),
  ('NC', 'No cotizamos'),
  ('P', 'Pendiente')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO comercial_catalogo_modo_entrega (nombre) VALUES
  ('Mail'),
  ('Portal'),
  ('Otro')
ON CONFLICT (nombre) DO NOTHING;

-- RLS habilitado como cinturón de seguridad extra: el backend usa la service
-- role key (bypassea RLS) para todo el control de acceso real, que sigue
-- viviendo en server/lib/permisos.js. Esto sólo protege ante un uso futuro
-- accidental de la anon key directamente desde el navegador.
ALTER TABLE comercial_perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_catalogo_categoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_catalogo_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_catalogo_cotizador ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_catalogo_modo_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_historial_cambios ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercial_log_accesos ENABLE ROW LEVEL SECURITY;

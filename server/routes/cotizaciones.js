const express = require('express');
const db = require('../lib/db');
const { registrarCambios, registrarRevision } = require('../lib/auditoria');
const {
  filtrarCamposEditables, puedeCrear, puedeBorrar, puedeEditarFila, puedeCrearRevision, CAMPOS_EDITABLES_POR_ROL,
} = require('../lib/permisos');

const router = express.Router();

// Le dice al frontend qué puede hacer el usuario logueado, para dibujar el
// formulario en consecuencia (campos habilitados, botón de alta/baja, etc.)
router.get('/api/whoami', (req, res) => {
  const usuario = req.usuario;
  res.json({
    usuario,
    campos_editables: CAMPOS_EDITABLES_POR_ROL[usuario.rol] || [],
    puede_crear: puedeCrear(usuario.rol),
    puede_borrar: puedeBorrar(usuario.rol),
    puede_crear_revision: puedeCrearRevision(usuario.rol),
  });
});

const SELECT_BASE = `
  SELECT
    c.*,
    cat.nombre AS categoria_nombre,
    est.codigo AS estado_codigo,
    est.nombre AS estado_nombre,
    cz.iniciales AS cotizador_iniciales,
    me.nombre AS modo_entrega_nombre,
    u.nombre_completo AS responsable_comercial_nombre
  FROM cotizaciones c
  LEFT JOIN catalogo_categoria cat ON cat.id = c.categoria_id
  LEFT JOIN catalogo_estado est ON est.id = c.estado_id
  LEFT JOIN catalogo_cotizador cz ON cz.id = c.cotizador_id
  LEFT JOIN catalogo_modo_entrega me ON me.id = c.modo_entrega_id
  LEFT JOIN perfiles u ON u.id = c.responsable_comercial_id
`;

async function obtenerCotizacion(id) {
  const { rows } = await db.query(`${SELECT_BASE} WHERE c.id = $1`, [id]);
  return rows[0];
}

// Grupo de revisiones al que pertenece una fila: la fila de revisión 0 (original)
// tiene cotizacion_original_id NULL, así que su propio id hace de identificador
// del grupo; el resto apunta directamente a ese id.
function idGrupoRevision(fila) {
  return fila.cotizacion_original_id || fila.id;
}

// Por defecto el listado y los tableros sólo cuentan la ÚLTIMA revisión de
// cada cotización (si se reabrió 2 veces, sólo se ve/cuenta la Rev. 2), así
// no se duplican ni se inflan las cifras de los indicadores ISO. El
// historial completo de revisiones sigue disponible por cotización vía
// GET /api/cotizaciones/:id/revisiones.
const SOLO_ULTIMA_REVISION = `
  NOT EXISTS (
    SELECT 1 FROM cotizaciones c2
    WHERE COALESCE(c2.cotizacion_original_id, c2.id) = COALESCE(c.cotizacion_original_id, c.id)
      AND c2.revision > c.revision
  )
`;

// Pequeño helper para armar condiciones dinámicas con params posicionales
// ($1, $2, ...) sin tener que llevar la cuenta a mano en cada ruta.
function creadorParams() {
  const params = [];
  return {
    params,
    ph(valor) {
      params.push(valor);
      return `$${params.length}`;
    },
  };
}

// Listado con filtros (todos los roles logueados pueden ver todo, para dar visibilidad
// a gerencia/comercial tal como se pidió).
router.get('/api/cotizaciones', async (req, res) => {
  const { categoria_id, estado_id, adjudicado, cotizador_id, modo_entrega_id, responsable_comercial_id, q, oferta, desde, hasta } = req.query;
  const { params, ph } = creadorParams();
  const cond = [SOLO_ULTIMA_REVISION];

  if (categoria_id) cond.push(`c.categoria_id = ${ph(Number(categoria_id))}`);
  if (estado_id) cond.push(`c.estado_id = ${ph(Number(estado_id))}`);
  // adjudicado: 0 = No, 1 = Sí, 2 = A otro proveedor
  if (adjudicado === '0' || adjudicado === '1' || adjudicado === '2') {
    cond.push(`c.adjudicado = ${ph(Number(adjudicado))}`);
  }
  if (cotizador_id) cond.push(`c.cotizador_id = ${ph(Number(cotizador_id))}`);
  if (modo_entrega_id) cond.push(`c.modo_entrega_id = ${ph(Number(modo_entrega_id))}`);
  if (responsable_comercial_id) cond.push(`c.responsable_comercial_id = ${ph(responsable_comercial_id)}`);
  if (desde) cond.push(`c.fecha_limite >= ${ph(desde)}`);
  if (hasta) cond.push(`c.fecha_limite <= ${ph(hasta)}`);
  if (q) {
    const p = ph(`%${q}%`);
    cond.push(`(c.nombre ILIKE ${p} OR c.cliente ILIKE ${p} OR c.comprador ILIKE ${p} OR c.numero_oferta ILIKE ${p})`);
  }
  // Filtro dedicado por número de oferta, en reemplazo del filtro por
  // categoría (se sacó del listado a pedido del usuario). Se busca por
  // coincidencia parcial porque así se suele ubicar una cotización ya
  // "Cotizada" cuando se tiene sólo el número de oferta a mano.
  if (oferta) cond.push(`c.numero_oferta ILIKE ${ph(`%${oferta}%`)}`);

  const where = `WHERE ${cond.join(' AND ')}`;
  // Orden por defecto: F. Presentación de la más próxima a la menos próxima.
  // "(c.fecha_limite IS NULL)" antes que la fecha en sí asegura que las
  // cotizaciones sin fecha queden al final en vez de saltar al principio.
  const { rows } = await db.query(
    `${SELECT_BASE} ${where} ORDER BY (c.fecha_limite IS NULL) ASC, c.fecha_limite ASC, c.id DESC`,
    params,
  );
  res.json(rows);
});

// Solapa "Comercial" — el subconjunto de cotizaciones que el equipo comercial
// sigue activamente. Reglas fijas (decisión del usuario, no configurables
// desde la UI): estado "Cotizado", F. Presentación desde 2026 en adelante
// (las anteriores no tienen efecto en esta solapa), y todavía sin resolver
// (Adjudicado en "No" o sin definir). En cuanto Adjudicado pasa a "Sí" o "A
// otro proveedor" —desde esta solapa o desde Listado—, la fila deja de
// cumplir esta condición y desaparece sola de acá (sigue viéndose
// normalmente en Listado). Se muestran todas las cotizaciones que cumplen el
// criterio, sin filtrar por a quién estén asignadas.
const FECHA_INICIO_COMERCIAL = '2026-01-01';

router.get('/api/cotizaciones/comercial', async (req, res) => {
  const { cliente, oferta, comprador } = req.query;
  const { rows: estadoRows } = await db.query("SELECT id FROM catalogo_estado WHERE codigo = 'C'");
  const estadoCotizado = estadoRows[0];

  const { params, ph } = creadorParams();
  const cond = [
    SOLO_ULTIMA_REVISION,
    `c.fecha_limite >= ${ph(FECHA_INICIO_COMERCIAL)}`,
    '(c.adjudicado IS NULL OR c.adjudicado = 0)',
  ];
  if (estadoCotizado) {
    cond.push(`c.estado_id = ${ph(estadoCotizado.id)}`);
  } else {
    // No debería pasar (el catálogo de estados se siembra solo), pero si el
    // estado "Cotizado" no existiera en la base, no mostrar nada en vez de
    // mostrar de más.
    cond.push('1 = 0');
  }
  // Filtros propios de esta solapa, todos por coincidencia parcial.
  if (cliente) cond.push(`c.cliente ILIKE ${ph(`%${cliente}%`)}`);
  if (oferta) cond.push(`c.numero_oferta ILIKE ${ph(`%${oferta}%`)}`);
  if (comprador) cond.push(`c.comprador ILIKE ${ph(`%${comprador}%`)}`);

  const where = `WHERE ${cond.join(' AND ')}`;
  // A pedido del usuario, esta solapa ordena de la F. Presentación más
  // reciente a la más vieja (al revés que Listado, que ordena de la más
  // próxima a vencer a la menos próxima). Como el WHERE de arriba ya exige
  // fecha_limite >= 2026, no hace falta una regla aparte para fechas vacías
  // (quedan excluidas por el filtro).
  const { rows } = await db.query(
    `${SELECT_BASE} ${where} ORDER BY c.fecha_limite DESC, c.id DESC`,
    params,
  );
  res.json(rows);
});

router.get('/api/cotizaciones/:id', async (req, res) => {
  const fila = await obtenerCotizacion(req.params.id);
  if (!fila) return res.status(404).json({ error: 'No encontrada' });
  res.json(fila);
});

router.get('/api/cotizaciones/:id/historial', async (req, res) => {
  const { rows } = await db.query(`
    SELECT h.*, u.nombre_completo AS usuario_nombre
    FROM historial_cambios h
    LEFT JOIN perfiles u ON u.id = h.usuario_id
    WHERE h.cotizacion_id = $1
    ORDER BY h.fecha DESC, h.id DESC
  `, [req.params.id]);
  res.json(rows);
});

// Todas las revisiones de la misma cotización (la original y cada vuelta),
// para que la ficha pueda mostrar el historial completo y permitir abrir
// cualquiera de las anteriores.
router.get('/api/cotizaciones/:id/revisiones', async (req, res) => {
  const { rows: filaRows } = await db.query(
    'SELECT id, cotizacion_original_id FROM cotizaciones WHERE id = $1',
    [req.params.id],
  );
  const fila = filaRows[0];
  if (!fila) return res.status(404).json({ error: 'No encontrada' });
  const grupoId = idGrupoRevision(fila);
  const { rows } = await db.query(`
    ${SELECT_BASE}
    WHERE COALESCE(c.cotizacion_original_id, c.id) = $1
    ORDER BY c.revision ASC
  `, [grupoId]);
  res.json(rows);
});

// Genera una revisión nueva a partir de una cotización existente. Copia
// todos los campos de la fila actual a una fila NUEVA (no pisa la anterior),
// le suma 1 al número de revisión y guarda el motivo por el que se reabrió
// (ej. "Responder consultas del cliente"). Sólo admin y gerencia pueden
// hacerlo.
router.post('/api/cotizaciones/:id/revisiones', async (req, res) => {
  const usuario = req.usuario;
  if (!puedeCrearRevision(usuario.rol)) {
    return res.status(403).json({ error: 'No tenés permiso para generar una revisión' });
  }

  const motivo = (req.body.motivo_revision || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Falta indicar el motivo de la revisión' });

  const { rows: existenteRows } = await db.query('SELECT * FROM cotizaciones WHERE id = $1', [req.params.id]);
  const existente = existenteRows[0];
  if (!existente) return res.status(404).json({ error: 'No encontrada' });

  const grupoId = idGrupoRevision(existente);
  const { rows: maxRows } = await db.query(
    'SELECT MAX(revision) AS max FROM cotizaciones WHERE COALESCE(cotizacion_original_id, id) = $1',
    [grupoId],
  );
  const ultimaRevision = maxRows[0].max;
  const revisionNueva = (ultimaRevision ?? existente.revision) + 1;

  // Se copian todos los campos de datos de la fila existente; lo único que
  // cambia es la identidad (id nuevo), el número de revisión, el motivo, a
  // qué grupo pertenece, y quién/cuándo la creó. Estado y Adjudicado se
  // copian tal cual estaban (decisión del usuario) — se ajustan a mano si
  // corresponde.
  const { rows: nuevaRows } = await db.query(`
    INSERT INTO cotizaciones (
      fecha_recepcion, nombre, cliente, fecha_limite, cotizador_id, observaciones,
      comprador, contacto_comprador, estado_id, adjudicado, numero_oferta, ot,
      toneladas, toneladas_ejecutadas, categoria_id, responsable_comercial_id,
      modo_entrega_id, monto_cotizado, monto_adjudicado, moneda, tipo_cotizacion,
      hora_cierre, porcentaje_mayor_costo, revision, motivo_revision, cotizacion_original_id, origen,
      creado_por_id, actualizado_por_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, 'revision',
      $27, $27
    ) RETURNING id
  `, [
    existente.fecha_recepcion, existente.nombre, existente.cliente, existente.fecha_limite,
    existente.cotizador_id, existente.observaciones, existente.comprador, existente.contacto_comprador,
    existente.estado_id, existente.adjudicado, existente.numero_oferta, existente.ot,
    existente.toneladas, existente.toneladas_ejecutadas, existente.categoria_id, existente.responsable_comercial_id,
    existente.modo_entrega_id, existente.monto_cotizado, existente.monto_adjudicado, existente.moneda,
    existente.tipo_cotizacion, existente.hora_cierre, existente.porcentaje_mayor_costo,
    revisionNueva, motivo, grupoId,
    usuario.id,
  ]);
  const nuevaId = nuevaRows[0].id;

  await registrarRevision(db, {
    cotizacionOrigenId: existente.id,
    cotizacionNuevaId: nuevaId,
    usuarioId: usuario.id,
    revisionAnterior: existente.revision,
    revisionNueva,
    motivo,
  });

  res.status(201).json(await obtenerCotizacion(nuevaId));
});

router.post('/api/cotizaciones', async (req, res) => {
  const usuario = req.usuario;
  if (!puedeCrear(usuario.rol)) return res.status(403).json({ error: 'No tenés permiso para crear cotizaciones' });

  const campos = filtrarCamposEditables(usuario.rol, req.body);
  if (!campos.nombre) return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });

  const columnas = Object.keys(campos);
  const valores = columnas.map((c) => campos[c]);
  const placeholders = columnas.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(`
    INSERT INTO cotizaciones (${columnas.join(', ')}, creado_por_id, actualizado_por_id)
    VALUES (${placeholders}, $${valores.length + 1}, $${valores.length + 1})
    RETURNING id
  `, [...valores, usuario.id]);
  const nuevaId = rows[0].id;

  await registrarCambios(db, { cotizacionId: nuevaId, usuarioId: usuario.id, accion: 'create' });
  res.status(201).json(await obtenerCotizacion(nuevaId));
});

router.put('/api/cotizaciones/:id', async (req, res) => {
  const usuario = req.usuario;
  const { rows: existenteRows } = await db.query('SELECT * FROM cotizaciones WHERE id = $1', [req.params.id]);
  const existente = existenteRows[0];
  if (!existente) return res.status(404).json({ error: 'No encontrada' });
  if (!puedeEditarFila(usuario, existente)) {
    return res.status(403).json({ error: 'Esta cotización no te está asignada' });
  }

  const campos = filtrarCamposEditables(usuario.rol, req.body);
  if (Object.keys(campos).length === 0) {
    return res.status(403).json({ error: 'No tenés permiso para editar ninguno de esos campos' });
  }

  const columnas = Object.keys(campos);
  const valores = columnas.map((c) => campos[c]);
  const asignaciones = columnas.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await db.query(`
    UPDATE cotizaciones
    SET ${asignaciones}, actualizado_por_id = $${valores.length + 1}, actualizado_en = now()
    WHERE id = $${valores.length + 2}
  `, [...valores, usuario.id, req.params.id]);

  const actualizado = await obtenerCotizacion(req.params.id);
  await registrarCambios(db, {
    cotizacionId: req.params.id,
    usuarioId: usuario.id,
    antes: existente,
    despues: { ...existente, ...campos },
    accion: 'update',
  });
  res.json(actualizado);
});

router.delete('/api/cotizaciones/:id', async (req, res) => {
  const usuario = req.usuario;
  if (!puedeBorrar(usuario.rol)) return res.status(403).json({ error: 'No tenés permiso para borrar' });
  const { rows: existenteRows } = await db.query('SELECT * FROM cotizaciones WHERE id = $1', [req.params.id]);
  if (!existenteRows[0]) return res.status(404).json({ error: 'No encontrada' });

  await registrarCambios(db, { cotizacionId: req.params.id, usuarioId: usuario.id, accion: 'delete' });
  await db.query('DELETE FROM cotizaciones WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Catálogos para poblar los combos del formulario
router.get('/api/catalogos', async (req, res) => {
  const [categorias, estados, cotizadores, modosEntrega, usuarios] = await Promise.all([
    db.query('SELECT * FROM catalogo_categoria WHERE activo = true ORDER BY nombre'),
    db.query('SELECT * FROM catalogo_estado ORDER BY id'),
    db.query('SELECT * FROM catalogo_cotizador WHERE activo = true ORDER BY iniciales'),
    db.query('SELECT * FROM catalogo_modo_entrega ORDER BY id'),
    db.query("SELECT id, nombre_completo, rol FROM perfiles WHERE activo = true ORDER BY nombre_completo"),
  ]);
  res.json({
    categorias: categorias.rows,
    estados: estados.rows,
    cotizadores: cotizadores.rows,
    modos_entrega: modosEntrega.rows,
    usuarios: usuarios.rows,
  });
});

module.exports = router;

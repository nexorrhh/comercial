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
  const usuario = req.session.usuario;
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
  LEFT JOIN usuarios u ON u.id = c.responsable_comercial_id
`;

function obtenerCotizacion(id) {
  return db.prepare(`${SELECT_BASE} WHERE c.id = ?`).get(id);
}

// Grupo de revisiones al que pertenece una fila: la fila de revisión 0 (original)
// tiene cotizacion_original_id NULL, así que su propio id hace de identificador
// del grupo; el resto apunta directamente a ese id.
function idGrupoRevision(fila) {
  return fila.cotizacion_original_id || fila.id;
}

// Actualización 5: por defecto el listado y los tableros sólo cuentan la ÚLTIMA
// revisión de cada cotización (si se reabrió 2 veces, sólo se ve/cuenta la Rev. 2),
// así no se duplican ni se inflan las cifras de los indicadores ISO. El historial
// completo de revisiones sigue disponible por cotización vía
// GET /api/cotizaciones/:id/revisiones.
const SOLO_ULTIMA_REVISION = `
  NOT EXISTS (
    SELECT 1 FROM cotizaciones c2
    WHERE COALESCE(c2.cotizacion_original_id, c2.id) = COALESCE(c.cotizacion_original_id, c.id)
      AND c2.revision > c.revision
  )
`;

// Listado con filtros (todos los roles logueados pueden ver todo, para dar visibilidad
// a gerencia/comercial tal como se pidió).
router.get('/api/cotizaciones', (req, res) => {
  const { categoria_id, estado_id, adjudicado, cotizador_id, modo_entrega_id, responsable_comercial_id, q, oferta, desde, hasta } = req.query;
  const cond = [SOLO_ULTIMA_REVISION];
  const params = {};

  if (categoria_id) { cond.push('c.categoria_id = @categoria_id'); params.categoria_id = categoria_id; }
  if (estado_id) { cond.push('c.estado_id = @estado_id'); params.estado_id = estado_id; }
  // adjudicado: 0 = No, 1 = Sí, 2 = A otro proveedor (Actualización 3)
  if (adjudicado === '0' || adjudicado === '1' || adjudicado === '2') {
    cond.push('c.adjudicado = @adjudicado'); params.adjudicado = adjudicado;
  }
  if (cotizador_id) { cond.push('c.cotizador_id = @cotizador_id'); params.cotizador_id = cotizador_id; }
  if (modo_entrega_id) { cond.push('c.modo_entrega_id = @modo_entrega_id'); params.modo_entrega_id = modo_entrega_id; }
  if (responsable_comercial_id) { cond.push('c.responsable_comercial_id = @responsable_comercial_id'); params.responsable_comercial_id = responsable_comercial_id; }
  if (desde) { cond.push('c.fecha_limite >= @desde'); params.desde = desde; }
  if (hasta) { cond.push('c.fecha_limite <= @hasta'); params.hasta = hasta; }
  if (q) { cond.push('(c.nombre LIKE @q OR c.cliente LIKE @q OR c.comprador LIKE @q OR c.numero_oferta LIKE @q)'); params.q = `%${q}%`; }
  // Actualización 6: filtro dedicado por número de oferta, en reemplazo del
  // filtro por categoría (se sacó del listado a pedido del usuario). Se busca
  // por coincidencia parcial porque así se suele ubicar una cotización ya
  // "Cotizada" cuando se tiene sólo el número de oferta a mano.
  if (oferta) { cond.push('c.numero_oferta LIKE @oferta'); params.oferta = `%${oferta}%`; }

  const where = `WHERE ${cond.join(' AND ')}`;
  // Orden por defecto (Actualización 4): F. Presentación de la más próxima a la
  // menos próxima. "(c.fecha_limite IS NULL)" antes que la fecha en sí asegura
  // que las cotizaciones sin fecha queden al final en vez de saltar al principio
  // (en SQLite, NULL ordena primero en ASC si no se lo empuja aparte).
  const filas = db.prepare(`${SELECT_BASE} ${where} ORDER BY (c.fecha_limite IS NULL) ASC, c.fecha_limite ASC, c.id DESC`).all(params);
  res.json(filas);
});

// Actualización 6: solapa "Comercial" — el subconjunto de cotizaciones que el
// equipo comercial sigue activamente. Reglas fijas (decisión del usuario, no
// configurables desde la UI): estado "Cotizado", F. Presentación desde 2026 en
// adelante (las anteriores no tienen efecto en esta solapa), y todavía sin
// resolver (Adjudicado en "No" o sin definir). En cuanto Adjudicado pasa a "Sí"
// o "A otro proveedor" —desde esta solapa o desde Listado—, la fila deja de
// cumplir esta condición y desaparece sola de acá (sigue viéndose normalmente
// en Listado). Se muestran todas las cotizaciones que cumplen el criterio, sin
// filtrar por a quién estén asignadas.
const FECHA_INICIO_COMERCIAL = '2026-01-01';

router.get('/api/cotizaciones/comercial', (req, res) => {
  const { cliente, oferta, comprador } = req.query;
  const estadoCotizado = db.prepare("SELECT id FROM catalogo_estado WHERE codigo = 'C'").get();
  const cond = [
    SOLO_ULTIMA_REVISION,
    'c.fecha_limite >= @desde',
    '(c.adjudicado IS NULL OR c.adjudicado = 0)',
  ];
  const params = { desde: FECHA_INICIO_COMERCIAL };
  if (estadoCotizado) {
    cond.push('c.estado_id = @estado_id');
    params.estado_id = estadoCotizado.id;
  } else {
    // No debería pasar (el catálogo de estados se siembra solo), pero si el
    // estado "Cotizado" no existiera en la base, no mostrar nada en vez de
    // mostrar de más.
    cond.push('0 = 1');
  }
  // Filtros propios de esta solapa (Actualización 7), todos por coincidencia parcial.
  if (cliente) { cond.push('c.cliente LIKE @cliente'); params.cliente = `%${cliente}%`; }
  if (oferta) { cond.push('c.numero_oferta LIKE @oferta'); params.oferta = `%${oferta}%`; }
  if (comprador) { cond.push('c.comprador LIKE @comprador'); params.comprador = `%${comprador}%`; }

  const where = `WHERE ${cond.join(' AND ')}`;
  // Actualización 7: a pedido del usuario, esta solapa ordena de la F. Presentación
  // más reciente a la más vieja (al revés que Listado, que ordena de la más próxima
  // a vencer a la menos próxima). Como el WHERE de arriba ya exige fecha_limite >= 2026,
  // no hace falta una regla aparte para fechas vacías (quedan excluidas por el filtro).
  const filas = db.prepare(`${SELECT_BASE} ${where} ORDER BY c.fecha_limite DESC, c.id DESC`).all(params);
  res.json(filas);
});

router.get('/api/cotizaciones/:id', (req, res) => {
  const fila = obtenerCotizacion(req.params.id);
  if (!fila) return res.status(404).json({ error: 'No encontrada' });
  res.json(fila);
});

router.get('/api/cotizaciones/:id/historial', (req, res) => {
  const historial = db.prepare(`
    SELECT h.*, u.nombre_completo AS usuario_nombre
    FROM historial_cambios h
    LEFT JOIN usuarios u ON u.id = h.usuario_id
    WHERE h.cotizacion_id = ?
    ORDER BY h.fecha DESC, h.id DESC
  `).all(req.params.id);
  res.json(historial);
});

// Actualización 5: todas las revisiones de la misma cotización (la original y
// cada vuelta), para que la ficha pueda mostrar el historial completo y permitir
// abrir cualquiera de las anteriores.
router.get('/api/cotizaciones/:id/revisiones', (req, res) => {
  const fila = db.prepare('SELECT id, cotizacion_original_id FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!fila) return res.status(404).json({ error: 'No encontrada' });
  const grupoId = idGrupoRevision(fila);
  const filas = db.prepare(`
    ${SELECT_BASE}
    WHERE COALESCE(c.cotizacion_original_id, c.id) = ?
    ORDER BY c.revision ASC
  `).all(grupoId);
  res.json(filas);
});

// Actualización 5: genera una revisión nueva a partir de una cotización existente.
// Copia todos los campos de la fila actual a una fila NUEVA (no pisa la anterior),
// le suma 1 al número de revisión y guarda el motivo por el que se reabrió
// (ej. "Responder consultas del cliente"). Sólo admin y gerencia pueden hacerlo.
router.post('/api/cotizaciones/:id/revisiones', (req, res) => {
  const usuario = req.session.usuario;
  if (!puedeCrearRevision(usuario.rol)) {
    return res.status(403).json({ error: 'No tenés permiso para generar una revisión' });
  }

  const motivo = (req.body.motivo_revision || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Falta indicar el motivo de la revisión' });

  const existente = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'No encontrada' });

  const grupoId = idGrupoRevision(existente);
  const { max: ultimaRevision } = db.prepare(`
    SELECT MAX(revision) AS max FROM cotizaciones
    WHERE COALESCE(cotizacion_original_id, id) = ?
  `).get(grupoId);
  const revisionNueva = (ultimaRevision ?? existente.revision) + 1;

  // Se copian todos los campos de datos de la fila existente; lo único que cambia
  // es la identidad (id nuevo), el número de revisión, el motivo, a qué grupo
  // pertenece, y quién/cuándo la creó. Estado y Adjudicado se copian tal cual
  // estaban (decisión del usuario) — se ajustan a mano si corresponde.
  const camposDatos = {
    fecha_recepcion: existente.fecha_recepcion,
    nombre: existente.nombre,
    cliente: existente.cliente,
    fecha_limite: existente.fecha_limite,
    cotizador_id: existente.cotizador_id,
    observaciones: existente.observaciones,
    comprador: existente.comprador,
    contacto_comprador: existente.contacto_comprador,
    estado_id: existente.estado_id,
    adjudicado: existente.adjudicado,
    numero_oferta: existente.numero_oferta,
    ot: existente.ot,
    toneladas: existente.toneladas,
    toneladas_ejecutadas: existente.toneladas_ejecutadas,
    categoria_id: existente.categoria_id,
    responsable_comercial_id: existente.responsable_comercial_id,
    modo_entrega_id: existente.modo_entrega_id,
    monto_cotizado: existente.monto_cotizado,
    monto_adjudicado: existente.monto_adjudicado,
    moneda: existente.moneda,
    tipo_cotizacion: existente.tipo_cotizacion,
    hora_cierre: existente.hora_cierre,
    // Actualización 11
    porcentaje_mayor_costo: existente.porcentaje_mayor_costo,
  };

  const info = db.prepare(`
    INSERT INTO cotizaciones (
      fecha_recepcion, nombre, cliente, fecha_limite, cotizador_id, observaciones,
      comprador, contacto_comprador, estado_id, adjudicado, numero_oferta, ot,
      toneladas, toneladas_ejecutadas, categoria_id, responsable_comercial_id,
      modo_entrega_id, monto_cotizado, monto_adjudicado, moneda, tipo_cotizacion,
      hora_cierre, porcentaje_mayor_costo, revision, motivo_revision, cotizacion_original_id, origen,
      creado_por_id, actualizado_por_id
    ) VALUES (
      @fecha_recepcion, @nombre, @cliente, @fecha_limite, @cotizador_id, @observaciones,
      @comprador, @contacto_comprador, @estado_id, @adjudicado, @numero_oferta, @ot,
      @toneladas, @toneladas_ejecutadas, @categoria_id, @responsable_comercial_id,
      @modo_entrega_id, @monto_cotizado, @monto_adjudicado, @moneda, @tipo_cotizacion,
      @hora_cierre, @porcentaje_mayor_costo, @revision, @motivo_revision, @cotizacion_original_id, 'revision',
      @creado_por_id, @creado_por_id
    )
  `).run({
    ...camposDatos,
    revision: revisionNueva,
    motivo_revision: motivo,
    cotizacion_original_id: grupoId,
    creado_por_id: usuario.id,
  });

  registrarRevision(db, {
    cotizacionOrigenId: existente.id,
    cotizacionNuevaId: info.lastInsertRowid,
    usuarioId: usuario.id,
    revisionAnterior: existente.revision,
    revisionNueva,
    motivo,
  });

  res.status(201).json(obtenerCotizacion(info.lastInsertRowid));
});

router.post('/api/cotizaciones', (req, res) => {
  const usuario = req.session.usuario;
  if (!puedeCrear(usuario.rol)) return res.status(403).json({ error: 'No tenés permiso para crear cotizaciones' });

  const campos = filtrarCamposEditables(usuario.rol, req.body);
  if (!campos.nombre) return res.status(400).json({ error: 'El campo "nombre" es obligatorio' });

  const columnas = Object.keys(campos);
  const placeholders = columnas.map((c) => `@${c}`).join(', ');
  const stmt = db.prepare(`
    INSERT INTO cotizaciones (${columnas.join(', ')}, creado_por_id, actualizado_por_id)
    VALUES (${placeholders}, @creado_por_id, @creado_por_id)
  `);
  const info = stmt.run({ ...campos, creado_por_id: usuario.id });
  registrarCambios(db, { cotizacionId: info.lastInsertRowid, usuarioId: usuario.id, accion: 'create' });
  res.status(201).json(obtenerCotizacion(info.lastInsertRowid));
});

router.put('/api/cotizaciones/:id', (req, res) => {
  const usuario = req.session.usuario;
  const existente = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'No encontrada' });
  if (!puedeEditarFila(usuario, existente)) {
    return res.status(403).json({ error: 'Esta cotización no te está asignada' });
  }

  const campos = filtrarCamposEditables(usuario.rol, req.body);
  if (Object.keys(campos).length === 0) {
    return res.status(403).json({ error: 'No tenés permiso para editar ninguno de esos campos' });
  }

  const asignaciones = Object.keys(campos).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`
    UPDATE cotizaciones
    SET ${asignaciones}, actualizado_por_id = @usuario_id, actualizado_en = datetime('now')
    WHERE id = @id
  `).run({ ...campos, usuario_id: usuario.id, id: req.params.id });

  const actualizado = obtenerCotizacion(req.params.id);
  registrarCambios(db, {
    cotizacionId: req.params.id,
    usuarioId: usuario.id,
    antes: existente,
    despues: { ...existente, ...campos },
    accion: 'update',
  });
  res.json(actualizado);
});

router.delete('/api/cotizaciones/:id', (req, res) => {
  const usuario = req.session.usuario;
  if (!puedeBorrar(usuario.rol)) return res.status(403).json({ error: 'No tenés permiso para borrar' });
  const existente = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'No encontrada' });

  registrarCambios(db, { cotizacionId: req.params.id, usuarioId: usuario.id, accion: 'delete' });
  db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Catálogos para poblar los combos del formulario
router.get('/api/catalogos', (req, res) => {
  res.json({
    categorias: db.prepare('SELECT * FROM catalogo_categoria WHERE activo = 1 ORDER BY nombre').all(),
    estados: db.prepare('SELECT * FROM catalogo_estado ORDER BY id').all(),
    cotizadores: db.prepare('SELECT * FROM catalogo_cotizador WHERE activo = 1 ORDER BY iniciales').all(),
    modos_entrega: db.prepare('SELECT * FROM catalogo_modo_entrega ORDER BY id').all(),
    usuarios: db.prepare("SELECT id, nombre_completo, rol FROM usuarios WHERE activo = 1 ORDER BY nombre_completo").all(),
  });
});

module.exports = router;

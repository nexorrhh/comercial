// Reglas de permisos por rol para el listado de cotizaciones.
// Mantenerlas centralizadas acá evita que cada ruta reinvente el control de acceso.

const CAMPOS_EDITABLES_POR_ROL = {
  admin: [
    'fecha_recepcion', 'nombre', 'cliente', 'fecha_limite', 'cotizador_id',
    'observaciones', 'comprador', 'estado_id', 'adjudicado', 'numero_oferta',
    'ot', 'toneladas', 'toneladas_ejecutadas', 'categoria_id', 'responsable_comercial_id',
    'modo_entrega_id',
    // Actualización 3: montos, moneda, tipo de cotización y hora de cierre
    'monto_cotizado', 'monto_adjudicado', 'moneda', 'tipo_cotizacion', 'hora_cierre',
    // Actualización 4: mismo criterio que "comprador"
    'contacto_comprador',
    // Actualización 5: por si hace falta corregir el motivo de una revisión ya creada
    'motivo_revision',
    // Actualización 11: mismo criterio que los demás datos comerciales sensibles
    'porcentaje_mayor_costo',
  ],
  gerencia: [
    'fecha_limite', 'observaciones', 'comprador', 'estado_id', 'adjudicado',
    'numero_oferta', 'ot', 'toneladas', 'toneladas_ejecutadas', 'categoria_id', 'responsable_comercial_id',
    'modo_entrega_id',
    // Actualización 3: mismo criterio que los demás datos comerciales sensibles
    'monto_cotizado', 'monto_adjudicado', 'moneda', 'tipo_cotizacion', 'hora_cierre',
    // Actualización 4: mismo criterio que "comprador"
    'contacto_comprador',
    // Actualización 5: por si hace falta corregir el motivo de una revisión ya creada
    'motivo_revision',
    // Actualización 11: mismo criterio que los demás datos comerciales sensibles
    'porcentaje_mayor_costo',
  ],
  // Comercial no toca montos/moneda/tipo/hora de cierre ni el modo de entrega:
  // sigue limitado a estado, observaciones y adjudicado, igual que antes.
  // (Actualización 6: la solapa "Comercial" reutiliza este mismo criterio de
  // permisos — no se le agregó nada nuevo a esta lista. Actualización 13: se
  // agrega "% mayor costo" a esta lista por pedido explícito del usuario —
  // ahora comercial SÍ lo puede editar, siempre que la cotización le esté
  // asignada como responsable, igual que estado/observaciones/adjudicado.)
  comercial: ['estado_id', 'observaciones', 'adjudicado', 'porcentaje_mayor_costo'],
  lectura: [],
};

function puedeCrear(rol) {
  return rol === 'admin';
}

function puedeBorrar(rol) {
  return rol === 'admin';
}

function puedeVerTodo(rol) {
  return rol === 'admin' || rol === 'gerencia' || rol === 'lectura';
}

// Actualización 5: quién puede generar una nueva revisión de una cotización ya
// existente (reabrirla con todos los datos copiados en una fila nueva, sin pisar
// la anterior). Mismo criterio que edita los datos comerciales sensibles: admin
// y gerencia, no comercial ni lectura.
function puedeCrearRevision(rol) {
  return rol === 'admin' || rol === 'gerencia';
}

// Filtra el body entrante dejando sólo los campos que el rol puede tocar.
// Además, si es 'comercial', sólo puede editar si la cotización le está asignada.
function filtrarCamposEditables(rol, body) {
  const permitidos = CAMPOS_EDITABLES_POR_ROL[rol] || [];
  const salida = {};
  for (const campo of permitidos) {
    if (Object.prototype.hasOwnProperty.call(body, campo)) {
      salida[campo] = body[campo];
    }
  }
  return salida;
}

function puedeEditarFila(usuario, cotizacionExistente) {
  if (usuario.rol === 'admin' || usuario.rol === 'gerencia') return true;
  if (usuario.rol === 'comercial') {
    return cotizacionExistente.responsable_comercial_id === usuario.id;
  }
  return false;
}

module.exports = {
  CAMPOS_EDITABLES_POR_ROL,
  puedeCrear,
  puedeBorrar,
  puedeVerTodo,
  puedeCrearRevision,
  filtrarCamposEditables,
  puedeEditarFila,
};

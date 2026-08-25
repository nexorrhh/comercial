// Lógica del cuadro de diálogo (alta/edición + historial + revisiones) de una
// cotización. Compartida entre Listado y Comercial (Actualización 6) para no
// duplicar este formulario en dos archivos distintos: cada página llama a
// inicializarFicha() una vez al arrancar, y le pasa un callback "alGuardar"
// (y opcionalmente "alBorrar") para refrescar su propia tabla después de
// guardar/borrar/generar una revisión.

const ESTADO_FICHA = {
  whoami: null,
  catalogos: null,
  filaSeleccionada: null,
  alGuardar: null,
  alBorrar: null,
};

// Actualización 11: campos de monto con formato argentino (punto de miles,
// coma decimal). Se guardan/leen con fmtMontoAr/parsearMontoAr (public/js/api.js).
// "% Mayor costo" usa el mismo formateo (aunque no tenga miles en la práctica)
// para que el comportamiento del campo sea idéntico al resto.
const CAMPOS_MONTO = ['c-monto_cotizado', 'c-monto_adjudicado', 'c-porcentaje_mayor_costo'];

async function inicializarFicha({ alGuardar, alBorrar } = {}) {
  ESTADO_FICHA.whoami = await api('GET', '/api/whoami');
  ESTADO_FICHA.catalogos = await api('GET', '/api/catalogos');
  ESTADO_FICHA.alGuardar = alGuardar || null;
  ESTADO_FICHA.alBorrar = alBorrar || alGuardar || null;

  poblarSelectsFicha();

  document.getElementById('btn-cerrar-modal').addEventListener('click', cerrarModal);
  document.getElementById('form-cotizacion').addEventListener('submit', guardarCotizacion);
  document.getElementById('btn-borrar').addEventListener('click', borrarCotizacion);
  document.getElementById('btn-nueva-revision').addEventListener('click', generarRevision);

  // Reformatea el campo apenas se sale de él (blur), así lo que se ve mientras
  // se tipea queda libre (podés escribir "8850000.15" o "8850000,15" como te
  // resulte más cómodo) y al salir del campo siempre se normaliza a "8.850.000,15".
  CAMPOS_MONTO.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('blur', () => {
      const n = parsearMontoAr(el.value);
      el.value = n === null ? '' : fmtMontoAr(n);
    });
  });

  return ESTADO_FICHA;
}

function poblarSelectsFicha() {
  const { categorias, estados, cotizadores, modos_entrega, usuarios } = ESTADO_FICHA.catalogos;
  const opciones = (arr, texto) => arr.map((x) => `<option value="${x.id}">${escapeHtml(x[texto])}</option>`).join('');

  document.getElementById('c-categoria_id').insertAdjacentHTML('beforeend', opciones(categorias, 'nombre'));
  document.getElementById('c-estado_id').insertAdjacentHTML('beforeend', opciones(estados, 'nombre'));
  document.getElementById('c-cotizador_id').insertAdjacentHTML('beforeend', opciones(cotizadores, 'iniciales'));
  document.getElementById('c-modo_entrega_id').insertAdjacentHTML('beforeend', opciones(modos_entrega, 'nombre'));
  document.getElementById('c-responsable_comercial_id').insertAdjacentHTML('beforeend', opciones(usuarios, 'nombre_completo'));
}

function puedeEditarCampo(campo) {
  return ESTADO_FICHA.whoami.campos_editables.includes(campo);
}

function aplicarPermisosCampos(fila) {
  const esNueva = !fila;
  const esAdmin = ESTADO_FICHA.whoami.usuario.rol === 'admin';
  const esComercialAsignado = ESTADO_FICHA.whoami.usuario.rol === 'comercial'
    && fila && fila.responsable_comercial_id === ESTADO_FICHA.whoami.usuario.id;

  const mapaCampos = ['nombre', 'cliente', 'fecha_recepcion', 'fecha_limite', 'hora_cierre', 'comprador', 'contacto_comprador', 'cotizador_id',
    'modo_entrega_id', 'categoria_id', 'estado_id', 'adjudicado', 'numero_oferta', 'ot', 'toneladas', 'toneladas_ejecutadas',
    'tipo_cotizacion', 'moneda', 'monto_cotizado', 'monto_adjudicado', 'porcentaje_mayor_costo', 'observaciones', 'responsable_comercial_id', 'motivo_revision'];

  mapaCampos.forEach((campo) => {
    const el = document.getElementById(`c-${campo}`);
    if (!el) return;
    if (esNueva) {
      // "Motivo revisión" no aplica a una carga original (Rev. 0) — se completa
      // recién cuando se genera una revisión desde el botón "Nueva revisión".
      el.disabled = campo === 'motivo_revision' ? true : !ESTADO_FICHA.whoami.puede_crear;
      return;
    }
    // en una fila existente: sólo se puede tocar si el rol tiene el campo en su lista,
    // y si es 'comercial' además tiene que ser el responsable asignado (aunque la
    // cotización se esté viendo desde la solapa Comercial, que ahora lista TODAS las
    // "Cotizado" del período sin filtrar por responsable — ver Actualización 6).
    const puedeTocarCampo = puedeEditarCampo(campo) && (esAdmin || ESTADO_FICHA.whoami.usuario.rol === 'gerencia' || esComercialAsignado);
    el.disabled = !puedeTocarCampo;
  });
}

async function abrirModal(fila) {
  ESTADO_FICHA.filaSeleccionada = fila;
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-titulo').textContent = fila ? `Cotización #${fila.id}` : 'Nueva cotización';
  document.getElementById('c-id').value = fila ? fila.id : '';

  const set = (id, val) => { document.getElementById(id).value = val ?? ''; };
  set('c-nombre', fila?.nombre);
  set('c-cliente', fila?.cliente);
  set('c-fecha_recepcion', fila?.fecha_recepcion ? String(fila.fecha_recepcion).slice(0, 10) : '');
  set('c-fecha_limite', fila?.fecha_limite ? String(fila.fecha_limite).slice(0, 10) : '');
  set('c-revision', fila ? String(fila.revision ?? 0) : '0');
  set('c-motivo_revision', fila?.motivo_revision);
  set('c-hora_cierre', fila?.hora_cierre);
  set('c-comprador', fila?.comprador);
  set('c-contacto_comprador', fila?.contacto_comprador);
  set('c-cotizador_id', fila?.cotizador_id);
  set('c-modo_entrega_id', fila?.modo_entrega_id);
  set('c-categoria_id', fila?.categoria_id);
  set('c-estado_id', fila?.estado_id);
  set('c-adjudicado', fila ? String(fila.adjudicado ?? 0) : '0');
  set('c-numero_oferta', fila?.numero_oferta);
  set('c-ot', fila?.ot);
  set('c-toneladas', fila?.toneladas);
  set('c-toneladas_ejecutadas', fila?.toneladas_ejecutadas);
  set('c-tipo_cotizacion', fila?.tipo_cotizacion);
  set('c-moneda', fila?.moneda);
  // Actualización 11: los campos de monto (y "% Mayor costo") se muestran ya
  // formateados en argentino, no como número "pelado".
  set('c-monto_cotizado', fmtMontoAr(fila?.monto_cotizado));
  set('c-monto_adjudicado', fmtMontoAr(fila?.monto_adjudicado));
  set('c-porcentaje_mayor_costo', fmtMontoAr(fila?.porcentaje_mayor_costo));
  set('c-responsable_comercial_id', fila?.responsable_comercial_id);
  set('c-observaciones', fila?.observaciones);

  aplicarPermisosCampos(fila);

  document.getElementById('btn-borrar').style.display = (fila && ESTADO_FICHA.whoami.puede_borrar) ? 'inline-block' : 'none';
  document.getElementById('btn-nueva-revision').style.display = (fila && ESTADO_FICHA.whoami.puede_crear_revision) ? 'inline-block' : 'none';

  const seccionHistorial = document.getElementById('seccion-historial');
  const seccionRevisiones = document.getElementById('seccion-revisiones');
  if (fila) {
    seccionHistorial.style.display = 'block';
    const historial = await api('GET', `/api/cotizaciones/${fila.id}/historial`);
    document.getElementById('lista-historial').innerHTML = historial.length ? historial.map((h) => `
      <div class="historial-item">
        <div><strong>${escapeHtml(h.campo)}</strong>: ${escapeHtml(h.valor_anterior)} → ${escapeHtml(h.valor_nuevo)}</div>
        <div class="meta">${escapeHtml(h.usuario_nombre || 'sistema')} · ${h.fecha}</div>
      </div>
    `).join('') : '<p class="meta">Sin cambios registrados todavía.</p>';

    const revisiones = await api('GET', `/api/cotizaciones/${fila.id}/revisiones`);
    seccionRevisiones.style.display = revisiones.length > 1 ? 'block' : 'none';
    document.getElementById('lista-revisiones').innerHTML = revisiones.map((r) => `
      <div class="historial-item">
        <div>
          <strong>Rev. ${r.revision}${r.id === fila.id ? ' (esta ficha)' : ''}</strong>:
          ${escapeHtml(r.motivo_revision) || '<span class="meta">(carga original)</span>'}
        </div>
        <div class="meta">
          Estado: ${escapeHtml(r.estado_nombre)} · creada el ${fmtFecha(r.creado_en)}
          ${r.id !== fila.id ? `<button type="button" class="secundario" data-abrir-revision="${r.id}" style="margin-left:0.5rem; padding:0.1rem 0.5rem;">Abrir</button>` : ''}
        </div>
      </div>
    `).join('');
    document.querySelectorAll('[data-abrir-revision]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const otraFila = await api('GET', `/api/cotizaciones/${btn.dataset.abrirRevision}`);
        abrirModal(otraFila);
      });
    });
  } else {
    seccionHistorial.style.display = 'none';
    seccionRevisiones.style.display = 'none';
  }

  document.getElementById('modal-fondo').classList.add('abierto');
}

// Actualización 5: genera una revisión nueva de la cotización abierta (copia todos
// los datos a una fila nueva, sin pisar la actual) y abre esa revisión nueva ya
// lista para ajustar lo que corresponda (por ejemplo, volver a poner Estado en
// "Pendiente" si el motivo es responder una consulta del cliente).
async function generarRevision() {
  const id = document.getElementById('c-id').value;
  if (!id) return;
  const motivo = prompt('¿De qué se trata esta revisión? (ej: "Responder consultas del cliente")');
  if (motivo === null) return;
  if (!motivo.trim()) {
    document.getElementById('modal-error').textContent = 'Hace falta indicar el motivo de la revisión.';
    return;
  }
  try {
    const nueva = await api('POST', `/api/cotizaciones/${id}/revisiones`, { motivo_revision: motivo.trim() });
    if (ESTADO_FICHA.alGuardar) await ESTADO_FICHA.alGuardar();
    await abrirModal(nueva);
  } catch (e) {
    document.getElementById('modal-error').textContent = e.message;
  }
}

function cerrarModal() {
  document.getElementById('modal-fondo').classList.remove('abierto');
}

function leerFormulario() {
  const val = (id) => document.getElementById(id).value;
  return {
    nombre: val('c-nombre'),
    cliente: val('c-cliente'),
    fecha_recepcion: val('c-fecha_recepcion') || null,
    fecha_limite: val('c-fecha_limite') || null,
    hora_cierre: val('c-hora_cierre') || null,
    comprador: val('c-comprador'),
    contacto_comprador: val('c-contacto_comprador'),
    motivo_revision: val('c-motivo_revision'),
    cotizador_id: val('c-cotizador_id') || null,
    modo_entrega_id: val('c-modo_entrega_id') || null,
    categoria_id: val('c-categoria_id') || null,
    estado_id: val('c-estado_id') || null,
    adjudicado: Number(val('c-adjudicado')),
    numero_oferta: val('c-numero_oferta'),
    ot: val('c-ot'),
    toneladas: val('c-toneladas') ? Number(val('c-toneladas')) : null,
    toneladas_ejecutadas: val('c-toneladas_ejecutadas') ? Number(val('c-toneladas_ejecutadas')) : null,
    tipo_cotizacion: val('c-tipo_cotizacion') || null,
    moneda: val('c-moneda') || null,
    // Actualización 11: se leen con parsearMontoAr en vez de Number() directo,
    // porque el campo ahora es de texto con formato argentino ("8.850.000,15").
    monto_cotizado: parsearMontoAr(val('c-monto_cotizado')),
    monto_adjudicado: parsearMontoAr(val('c-monto_adjudicado')),
    porcentaje_mayor_costo: parsearMontoAr(val('c-porcentaje_mayor_costo')),
    responsable_comercial_id: val('c-responsable_comercial_id') || null,
    observaciones: val('c-observaciones'),
  };
}

async function guardarCotizacion(ev) {
  ev.preventDefault();
  const id = document.getElementById('c-id').value;
  const cuerpo = leerFormulario();
  try {
    if (id) {
      await api('PUT', `/api/cotizaciones/${id}`, cuerpo);
    } else {
      await api('POST', '/api/cotizaciones', cuerpo);
    }
    cerrarModal();
    if (ESTADO_FICHA.alGuardar) await ESTADO_FICHA.alGuardar();
  } catch (e) {
    document.getElementById('modal-error').textContent = e.message;
  }
}

async function borrarCotizacion() {
  const id = document.getElementById('c-id').value;
  if (!id) return;
  if (!confirm('¿Seguro que querés eliminar esta cotización? Queda registrado en el historial.')) return;
  try {
    await api('DELETE', `/api/cotizaciones/${id}`);
    cerrarModal();
    if (ESTADO_FICHA.alBorrar) await ESTADO_FICHA.alBorrar();
  } catch (e) {
    document.getElementById('modal-error').textContent = e.message;
  }
}

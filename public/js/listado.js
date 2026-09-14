// Lógica específica de la solapa Listado: filtros y tabla. El cuadro de
// diálogo (alta/edición/historial/revisiones) vive en ficha.js, compartido con
// la solapa Comercial (Actualización 6).

const PILL_ESTADO = { C: 'pill-c', NC: 'pill-nc', P: 'pill-p' };

async function iniciar() {
  const ficha = await inicializarFicha({ alGuardar: cargarListado });

  poblarSelectsListado();
  document.getElementById('btn-nueva').style.display = ficha.whoami.puede_crear ? 'inline-block' : 'none';

  // Actualización 4: al abrir el listado, filtrar por defecto por "Pendiente"
  // (el usuario puede sacar el filtro eligiendo "Todos" si quiere ver el resto).
  const estadoPendiente = ficha.catalogos.estados.find((e) => e.codigo === 'P');
  if (estadoPendiente) document.getElementById('f-estado').value = String(estadoPendiente.id);

  await cargarListado();

  document.getElementById('btn-filtrar').addEventListener('click', cargarListado);
  document.getElementById('btn-nueva').addEventListener('click', () => abrirModal(null));
  document.getElementById('btn-exportar').addEventListener('click', () => {
    window.location.href = `/api/cotizaciones/export?${armarParamsFiltro().toString()}`;
  });

  // Los combos de Estado y Adjudicado filtran solos apenas se elige una opción
  // (Actualización 2) — el botón "Filtrar" sigue haciendo falta sólo para el
  // buscador de texto, el filtro por Oferta (Actualización 6) y el rango de fechas.
  ['f-estado', 'f-adjudicado'].forEach((id) => {
    document.getElementById(id).addEventListener('change', cargarListado);
  });
}

function poblarSelectsListado() {
  const { estados } = ESTADO_FICHA.catalogos;
  const opciones = (arr, texto) => arr.map((x) => `<option value="${x.id}">${escapeHtml(x[texto])}</option>`).join('');
  document.getElementById('f-estado').insertAdjacentHTML('beforeend', opciones(estados, 'nombre'));
}

// Resaltado de F. Presentación: roja si ya venció, naranja si vence en los
// próximos 5 días. Sólo tiene sentido como alarma en cotizaciones que siguen
// "Pendientes" (P) — a las ya Cotizadas/No cotizadas no se les resalta la fecha.
function claseFecha(fila) {
  if (fila.estado_codigo !== 'P' || !fila.fecha_limite) return '';
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const limite = new Date(`${String(fila.fecha_limite).slice(0, 10)}T00:00:00`);
  const diffDias = Math.round((limite - hoy) / 86400000);
  if (diffDias < 0) return 'fecha-vencida';
  if (diffDias <= 5) return 'fecha-proxima';
  return '';
}

// Junta los filtros activos en la barra en un URLSearchParams, compartido
// entre cargarListado() y el botón de exportar a Excel para que el archivo
// descargado respete exactamente lo que se está viendo en pantalla.
function armarParamsFiltro() {
  const params = new URLSearchParams();
  const q = document.getElementById('f-q').value.trim();
  const oferta = document.getElementById('f-oferta').value.trim();
  const estado_id = document.getElementById('f-estado').value;
  const adjudicado = document.getElementById('f-adjudicado').value;
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  if (q) params.set('q', q);
  if (oferta) params.set('oferta', oferta);
  if (estado_id) params.set('estado_id', estado_id);
  if (adjudicado) params.set('adjudicado', adjudicado);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  return params;
}

async function cargarListado() {
  const filas = await api('GET', `/api/cotizaciones?${armarParamsFiltro().toString()}`);
  const tbody = document.getElementById('tbody-cotizaciones');
  tbody.innerHTML = filas.map((f) => `
    <tr data-id="${f.id}">
      <td>${f.revision ?? 0}</td>
      <td class="${claseFecha(f)}">${fmtFecha(f.fecha_limite)}</td>
      <td>${escapeHtml(f.hora_cierre)}</td>
      <td>${escapeHtml(f.modo_entrega_nombre)}</td>
      <td>${escapeHtml(f.cliente)}</td>
      <td>${escapeHtml(f.comprador)}</td>
      <td>${escapeHtml(f.nombre)}</td>
      <td>${escapeHtml(f.categoria_nombre)}</td>
      <td>${escapeHtml(f.cotizador_iniciales)}</td>
      <td>${f.estado_codigo ? `<span class="pill ${PILL_ESTADO[f.estado_codigo] || ''}">${f.estado_codigo}</span>` : ''}</td>
      <td>${escapeHtml(f.numero_oferta)}</td>
      <td>${f.toneladas ?? ''}</td>
      <td>${escapeHtml(f.motivo_revision)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => abrirModal(filas.find((f) => String(f.id) === tr.dataset.id)));
  });
}

iniciar();

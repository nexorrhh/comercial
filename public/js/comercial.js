// Lógica de la solapa Comercial (Actualización 6, filtros propios agregados en
// la Actualización 7): tabla filtrada por criterios fijos (estado Cotizado,
// F. Presentación desde 2026, sin resolver — ver server/routes/cotizaciones.js)
// más filtros de texto propios (Cliente/Oferta/Comprador), que abre el mismo
// cuadro de diálogo de ficha.js para completar Adjudicado/Observaciones.

async function iniciar() {
  await inicializarFicha({ alGuardar: cargarComercial });
  await cargarComercial();
  document.getElementById('btn-filtrar').addEventListener('click', cargarComercial);
}

async function cargarComercial() {
  const params = new URLSearchParams();
  const cliente = document.getElementById('f-cliente').value.trim();
  const oferta = document.getElementById('f-oferta').value.trim();
  const comprador = document.getElementById('f-comprador').value.trim();
  if (cliente) params.set('cliente', cliente);
  if (oferta) params.set('oferta', oferta);
  if (comprador) params.set('comprador', comprador);

  const filas = await api('GET', `/api/cotizaciones/comercial?${params.toString()}`);
  const tbody = document.getElementById('tbody-comercial');
  tbody.innerHTML = filas.map((f) => `
    <tr data-id="${f.id}">
      <td>${fmtFecha(f.fecha_limite)}</td>
      <td>${escapeHtml(f.cliente)}</td>
      <td>${escapeHtml(f.nombre)}</td>
      <td>${escapeHtml(f.categoria_nombre)}</td>
      <td>${escapeHtml(f.numero_oferta)}</td>
      <td>${f.revision ?? 0}</td>
      <td>${escapeHtml(f.cotizador_iniciales)}</td>
      <td>${f.toneladas ?? ''}</td>
      <td>${escapeHtml(f.moneda)}</td>
      <td>${fmtMontoAr(f.monto_cotizado)}</td>
      <td>${escapeHtml(f.comprador)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => abrirModal(filas.find((f) => String(f.id) === tr.dataset.id)));
  });
}

iniciar();

// Solapa "Indicadores" (Actualización 8, con filtro de fecha y diseño más
// amigable agregados en la Actualización 9 a pedido del usuario): reporte de
// sólo lectura con totales de monto y toneladas, cotizado y adjudicado,
// filtrando por Cliente, Comprador y/o un rango de F. Presentación. No usa
// ficha.js porque no abre ni edita cotizaciones individuales.

function claseMoneda(m) {
  if (m === 'USD') return 'moneda-usd';
  if (m === 'ARS') return 'moneda-ars';
  return '';
}

// Formato argentino (punto de miles, coma decimal) — mismo formato que se
// pidió aplicar en general a los montos del sistema (pendiente para otra
// ronda en la ficha/listado); acá se aplica directo porque son pantallas nuevas.
function fmtMonto(n) {
  return (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Tarjetas de moneda en vez de una tabla lisa — se ve más integrado con el
// resto de los tableros (mismo lenguaje visual que los stat-tiles).
function tarjetasMontos(filas) {
  if (!filas.length) return '<p class="moneda-vacio">Sin montos cargados para este filtro.</p>';
  return `
    <div class="moneda-grid">
      ${filas.map((f) => `
        <div class="moneda-card ${claseMoneda(f.moneda)}">
          <div class="moneda-cod">${escapeHtml(f.moneda || 'Sin moneda especificada')}</div>
          <div class="moneda-monto">${fmtMonto(f.total)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function fraseResumen(r, hayFiltro) {
  const cant = r.cantidad_cotizaciones || 0;
  if (!cant) return hayFiltro ? 'No encontramos cotizaciones para este filtro.' : 'Todavía no hay cotizaciones cargadas.';
  const adj = r.cantidad_adjudicadas || 0;
  const tasa = ((100 * adj) / cant).toFixed(1);
  const sujeto = hayFiltro ? `Encontramos ${cant} cotizaciones para este filtro` : `Hay ${cant} cotizaciones en total en el sistema`;
  return `${sujeto}, de las cuales ${adj} fueron adjudicadas (${tasa}%).`;
}

async function buscar() {
  const params = new URLSearchParams();
  const cliente = document.getElementById('i-cliente').value.trim();
  const comprador = document.getElementById('i-comprador').value.trim();
  const desde = document.getElementById('i-desde').value;
  const hasta = document.getElementById('i-hasta').value;
  if (cliente) params.set('cliente', cliente);
  if (comprador) params.set('comprador', comprador);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const hayFiltro = Boolean(cliente || comprador || desde || hasta);

  const r = await api('GET', `/api/dashboards/indicador-cliente-comprador?${params.toString()}`);

  document.getElementById('i-frase').textContent = fraseResumen(r, hayFiltro);

  const tasa = r.cantidad_cotizaciones ? ((100 * (r.cantidad_adjudicadas || 0)) / r.cantidad_cotizaciones).toFixed(1) : '0.0';
  const tiles = [
    ['Cotizaciones encontradas', r.cantidad_cotizaciones || 0],
    ['Adjudicadas', r.cantidad_adjudicadas || 0],
    ['Tasa de adjudicación', `${tasa}%`],
    ['Toneladas cotizadas', Math.round(r.toneladas_cotizadas || 0).toLocaleString('es-AR')],
    ['Toneladas adjudicadas', Math.round(r.toneladas_adjudicadas || 0).toLocaleString('es-AR')],
  ];
  document.getElementById('i-stat-tiles').innerHTML = tiles.map(([etiqueta, valor]) => `
    <div class="tarjeta stat-tile" style="margin-bottom:0;">
      <div class="valor">${valor}</div>
      <div class="etiqueta">${etiqueta}</div>
    </div>
  `).join('');

  document.getElementById('i-montos-cotizados').innerHTML = tarjetasMontos(r.montos_cotizados || []);
  document.getElementById('i-montos-adjudicados').innerHTML = tarjetasMontos(r.montos_adjudicados || []);
}

async function iniciar() {
  await buscar(); // sin filtros al entrar: muestra los totales generales de todo el sistema
  document.getElementById('btn-buscar').addEventListener('click', buscar);
}

iniciar();

const PALETA = {
  serie1: '#2a78d6',
  serie2: '#eb6834',
  serie3: '#1baf7a',
  textoSecundario: '#52514e',
  textoMuted: '#898781',
  grilla: '#e1e0d9',
};

Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
Chart.defaults.color = PALETA.textoSecundario;
Chart.defaults.borderColor = PALETA.grilla;

let chartToneladas, chartTasa;

async function iniciar() {
  await Promise.all([refrescarTodo(), iniciarResumenAnual()]);
  document.getElementById('d-btn-filtrar').addEventListener('click', refrescarTodo);
}

function paramsFecha() {
  const p = new URLSearchParams();
  const desde = document.getElementById('d-desde').value;
  const hasta = document.getElementById('d-hasta').value;
  if (desde) p.set('desde', desde);
  if (hasta) p.set('hasta', hasta);
  return p;
}

async function refrescarTodo() {
  await Promise.all([cargarResumen(), cargarToneladas(), cargarTasa()]);
}

async function cargarResumen() {
  const r = await api('GET', '/api/dashboards/resumen');
  const tasa = r.total_cotizaciones ? ((100 * (r.total_adjudicadas || 0)) / r.total_cotizaciones).toFixed(1) : '0.0';
  const tiles = [
    ['Cotizaciones totales', r.total_cotizaciones || 0],
    ['Adjudicadas', r.total_adjudicadas || 0],
    ['Tasa de adjudicación', `${tasa}%`],
    ['Toneladas cotizadas', Math.round(r.toneladas_cotizadas || 0).toLocaleString('es-AR')],
    ['Toneladas adjudicadas', Math.round(r.toneladas_adjudicadas || 0).toLocaleString('es-AR')],
  ];
  document.getElementById('stat-tiles').innerHTML = tiles.map(([etiqueta, valor]) => `
    <div class="tarjeta stat-tile" style="margin-bottom:0;">
      <div class="valor">${valor}</div>
      <div class="etiqueta">${etiqueta}</div>
    </div>
  `).join('');
}

// --- Actualización 8: resumen permanente por año --------------------------

function fmtMontoAnio(n) {
  return (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function claseMonedaAnio(m) {
  if (m === 'USD') return 'moneda-usd';
  if (m === 'ARS') return 'moneda-ars';
  return '';
}

// Mismo estilo de tarjetas por moneda que usa la solapa Indicadores, para que
// las dos pantallas se sientan parte del mismo sistema.
function tablaMontosAnio(filas) {
  if (!filas.length) return '<p class="moneda-vacio">Sin montos cargados para este año.</p>';
  return `
    <div class="moneda-grid">
      ${filas.map((f) => `
        <div class="moneda-card ${claseMonedaAnio(f.moneda)}">
          <div class="moneda-cod">${escapeHtml(f.moneda || 'Sin moneda especificada')}</div>
          <div class="moneda-monto">${fmtMontoAnio(f.total)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function iniciarResumenAnual() {
  const anios = await api('GET', '/api/dashboards/anios');
  const anioActual = String(new Date().getFullYear());
  const opciones = anios.includes(anioActual) ? anios : [anioActual, ...anios];
  const select = document.getElementById('ra-anio');
  select.innerHTML = opciones.map((a) => `<option value="${a}">${a}</option>`).join('');
  select.value = anioActual;
  select.addEventListener('change', cargarResumenAnual);
  await cargarResumenAnual();
}

async function cargarResumenAnual() {
  const anio = document.getElementById('ra-anio').value;
  const r = await api('GET', `/api/dashboards/resumen-anual?anio=${encodeURIComponent(anio)}`);
  const tiles = [
    ['Cotizaciones', r.cantidad_cotizaciones || 0],
    ['Adjudicadas', r.cantidad_adjudicadas || 0],
    ['Toneladas cotizadas', Math.round(r.toneladas_cotizadas || 0).toLocaleString('es-AR')],
    ['Toneladas adjudicadas', Math.round(r.toneladas_adjudicadas || 0).toLocaleString('es-AR')],
  ];
  document.getElementById('ra-stat-tiles').innerHTML = tiles.map(([etiqueta, valor]) => `
    <div class="tarjeta stat-tile" style="margin-bottom:0;">
      <div class="valor">${valor}</div>
      <div class="etiqueta">${etiqueta}</div>
    </div>
  `).join('');
  document.getElementById('ra-tabla-montos-cotizados').innerHTML = tablaMontosAnio(r.montos_cotizados || []);
  document.getElementById('ra-tabla-montos-adjudicados').innerHTML = tablaMontosAnio(r.montos_adjudicados || []);
}

// ----------------------------------------------------------------------------

async function cargarToneladas() {
  const params = paramsFecha();
  const filas = await api('GET', `/api/dashboards/toneladas?${params.toString()}`);
  const etiquetas = filas.map((f) => f.periodo);

  if (chartToneladas) chartToneladas.destroy();
  chartToneladas = new Chart(document.getElementById('chart-toneladas'), {
    type: 'line',
    data: {
      labels: etiquetas,
      datasets: [
        { label: 'Cotizadas', data: filas.map((f) => f.toneladas_cotizadas || 0), borderColor: PALETA.serie1, backgroundColor: PALETA.serie1, tension: 0.25, borderWidth: 2, pointRadius: 3 },
        { label: 'Adjudicadas', data: filas.map((f) => f.toneladas_adjudicadas || 0), borderColor: PALETA.serie2, backgroundColor: PALETA.serie2, tension: 0.25, borderWidth: 2, pointRadius: 3 },
        { label: 'Ejecutadas', data: filas.map((f) => f.toneladas_ejecutadas || 0), borderColor: PALETA.serie3, backgroundColor: PALETA.serie3, tension: 0.25, borderWidth: 2, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', align: 'end' }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: PALETA.grilla }, title: { display: true, text: 'Toneladas' } },
      },
    },
  });

  document.getElementById('tabla-toneladas').innerHTML = tablaSimple(
    ['Período', 'Cotizadas', 'Adjudicadas', 'Ejecutadas'],
    filas.map((f) => [f.periodo, f.toneladas_cotizadas || 0, f.toneladas_adjudicadas || 0, f.toneladas_ejecutadas || 0])
  );
}

const MINIMO_MUESTRAS_GRAFICO = 5;
const TOP_N_GRAFICO = 15;

async function cargarTasa() {
  const params = paramsFecha();
  const { filas } = await api('GET', `/api/dashboards/tasa-adjudicacion?${params.toString()}`);

  const conVolumen = filas.filter((f) => f.total_cotizaciones >= MINIMO_MUESTRAS_GRAFICO);
  const paraGrafico = conVolumen.slice(0, TOP_N_GRAFICO);
  const ocultasPorPocasMuestras = filas.length - conVolumen.length;
  const ocultasPorRecorte = conVolumen.length - paraGrafico.length;

  if (chartTasa) chartTasa.destroy();
  chartTasa = new Chart(document.getElementById('chart-tasa'), {
    type: 'bar',
    data: {
      labels: paraGrafico.map((f) => f.grupo),
      datasets: [
        { label: 'Tasa de adjudicación (%)', data: paraGrafico.map((f) => f.tasa_adjudicacion_pct || 0), backgroundColor: PALETA.serie1, borderRadius: 4, maxBarThickness: 28 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const f = paraGrafico[ctx.dataIndex];
              return `${f.tasa_adjudicacion_pct}% (${f.adjudicadas} de ${f.total_cotizaciones} cotizaciones)`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: PALETA.grilla }, title: { display: true, text: '% adjudicado' }, suggestedMax: 100 },
        y: { grid: { display: false } },
      },
    },
  });

  const notas = [];
  if (ocultasPorPocasMuestras > 0) notas.push(`${ocultasPorPocasMuestras} categoría(s) con menos de ${MINIMO_MUESTRAS_GRAFICO} cotizaciones no se grafican (la tasa no es representativa con tan poca muestra) — están en la tabla.`);
  if (ocultasPorRecorte > 0) notas.push(`Se muestran las ${TOP_N_GRAFICO} categorías de mayor volumen; el resto está en la tabla.`);
  document.getElementById('nota-tasa').textContent = notas.join(' ');

  document.getElementById('tabla-tasa').innerHTML = tablaSimple(
    ['Categoría', 'Cotizaciones', 'Adjudicadas', 'Tasa %'],
    filas.map((f) => [f.grupo, f.total_cotizaciones, f.adjudicadas, f.tasa_adjudicacion_pct])
  );
}

function tablaSimple(encabezados, filas) {
  return `
    <table>
      <thead><tr>${encabezados.map((e) => `<th>${escapeHtml(e)}</th>`).join('')}</tr></thead>
      <tbody>${filas.map((fila) => `<tr>${fila.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
}

iniciar();

const express = require('express');
const db = require('../lib/db');

const router = express.Router();

// Actualización 5: cada revisión de una cotización que se reabre queda como una
// fila propia en `cotizaciones` (ver server/routes/cotizaciones.js). Sin este
// filtro, los indicadores de abajo contarían una misma oportunidad comercial una
// vez por cada vez que se reabrió — este filtro se queda sólo con la ÚLTIMA
// revisión de cada grupo, igual que hace el listado por defecto.
const SOLO_ULTIMA_REVISION = `
  NOT EXISTS (
    SELECT 1 FROM cotizaciones c2
    WHERE COALESCE(c2.cotizacion_original_id, c2.id) = COALESCE(c.cotizacion_original_id, c.id)
      AND c2.revision > c.revision
  )
`;

// Indicador ISO 1: toneladas cotizadas / adjudicadas / ejecutadas a lo largo del tiempo,
// agrupado por mes (reemplaza a la hoja "GRAFICOS", que dependía de refrescar un pivot a mano).
router.get('/api/dashboards/toneladas', (req, res) => {
  const { desde, hasta, categoria_id } = req.query;
  const cond = ["c.fecha_limite IS NOT NULL", "c.fecha_limite != ''", SOLO_ULTIMA_REVISION];
  const params = {};
  if (desde) { cond.push('c.fecha_limite >= @desde'); params.desde = desde; }
  if (hasta) { cond.push('c.fecha_limite <= @hasta'); params.hasta = hasta; }
  if (categoria_id) { cond.push('c.categoria_id = @categoria_id'); params.categoria_id = categoria_id; }

  const filas = db.prepare(`
    SELECT
      substr(c.fecha_limite, 1, 7) AS periodo,
      SUM(c.toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN c.adjudicado = 1 THEN c.toneladas ELSE 0 END) AS toneladas_adjudicadas,
      SUM(COALESCE(c.toneladas_ejecutadas, 0)) AS toneladas_ejecutadas
    FROM cotizaciones c
    WHERE ${cond.join(' AND ')}
    GROUP BY periodo
    ORDER BY periodo
  `).all(params);
  res.json(filas);
});

// Indicador ISO 2: cantidad de cotizaciones presentadas vs. adjudicadas por categoría
// (y opcionalmente por período), es decir la tasa de éxito comercial.
// Reemplaza a la hoja "INDICADOR ISO". adjudicado = 1 sigue siendo el único valor que
// cuenta como "adjudicada" (el valor 2, "a otro proveedor", agregado en la Actualización 3,
// queda correctamente afuera sin tocar esta consulta).
router.get('/api/dashboards/tasa-adjudicacion', (req, res) => {
  const { desde, hasta, agrupar, minimo } = req.query; // agrupar = 'categoria' (default) | 'mes'
  const minimoMuestras = Number(minimo) || 1;
  const cond = [SOLO_ULTIMA_REVISION];
  const params = {};
  if (desde) { cond.push('c.fecha_limite >= @desde'); params.desde = desde; }
  if (hasta) { cond.push('c.fecha_limite <= @hasta'); params.hasta = hasta; }
  const where = `WHERE ${cond.join(' AND ')}`;

  const columnaAgrupacion = agrupar === 'mes'
    ? "substr(c.fecha_limite, 1, 7)"
    : "COALESCE(cat.nombre, '(sin categoría)')";

  const todas = db.prepare(`
    SELECT
      ${columnaAgrupacion} AS grupo,
      COUNT(*) AS total_cotizaciones,
      SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) AS adjudicadas,
      ROUND(100.0 * SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS tasa_adjudicacion_pct
    FROM cotizaciones c
    LEFT JOIN catalogo_categoria cat ON cat.id = c.categoria_id
    ${where}
    GROUP BY grupo
    ORDER BY total_cotizaciones DESC
  `).all(params);

  const filtradas = todas.filter((f) => f.total_cotizaciones >= minimoMuestras);
  res.json({
    filas: filtradas,
    ocultas_por_pocas_muestras: todas.length - filtradas.length,
  });
});

// Resumen general para la portada del dashboard
router.get('/api/dashboards/resumen', (req, res) => {
  const totales = db.prepare(`
    SELECT
      COUNT(*) AS total_cotizaciones,
      SUM(CASE WHEN adjudicado = 1 THEN 1 ELSE 0 END) AS total_adjudicadas,
      SUM(toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN adjudicado = 1 THEN toneladas ELSE 0 END) AS toneladas_adjudicadas
    FROM cotizaciones c
    WHERE ${SOLO_ULTIMA_REVISION}
  `).get();
  res.json(totales);
});

// --- Actualización 8: indicador libre por Cliente/Comprador + resumen anual ---
//
// Helper compartido: suma un campo de monto (monto_cotizado o monto_adjudicado)
// agrupado por moneda, sobre el mismo WHERE que ya se armó para el resto de la
// consulta (+ una condición extra opcional, ej. "sólo adjudicadas"). Se separan
// los totales por moneda (USD/ARS) en vez de sumarlos juntos, porque mezclar
// ambas monedas en un solo número no es correcto financieramente. Las filas sin
// moneda cargada quedan agrupadas aparte, bajo moneda = null — el frontend las
// muestra como "Sin moneda especificada".
function totalesPorMoneda(campoMonto, condBase, params, condicionExtra) {
  const cond = condBase.slice();
  if (condicionExtra) cond.push(condicionExtra);
  cond.push(`${campoMonto} IS NOT NULL`);
  return db.prepare(`
    SELECT moneda, SUM(${campoMonto}) AS total
    FROM cotizaciones c
    WHERE ${cond.join(' AND ')}
    GROUP BY moneda
  `).all(params);
}

// Indicador libre: totales de monto y toneladas, cotizado y adjudicado,
// filtrando por Cliente y/o Comprador (ambos opcionales, se pueden combinar —
// si no se manda ninguno, devuelve los totales de todo el sistema) y, a pedido
// del usuario tras probar la Actualización 8, también por un rango de fechas
// (F. Presentación / fecha_limite, mismo campo y mismos nombres de parámetro
// "desde"/"hasta" que ya usa el resto del sistema en Listado y en los otros
// tableros). Sólo cuenta la última revisión de cada cotización, igual criterio
// que el resto de los tableros. El criterio de "adjudicado" es el mismo ya
// establecido en el resto del sistema (adjudicado = 1); el monto adjudicado
// usa el campo monto_adjudicado y las toneladas adjudicadas usan el campo
// toneladas (cotizadas) de las filas con adjudicado = 1 — mismo cálculo que ya
// usa el tablero de toneladas por mes de arriba.
router.get('/api/dashboards/indicador-cliente-comprador', (req, res) => {
  const { cliente, comprador, desde, hasta } = req.query;
  const cond = [SOLO_ULTIMA_REVISION];
  const params = {};
  if (cliente) { cond.push('c.cliente LIKE @cliente'); params.cliente = `%${cliente}%`; }
  if (comprador) { cond.push('c.comprador LIKE @comprador'); params.comprador = `%${comprador}%`; }
  if (desde) { cond.push('c.fecha_limite >= @desde'); params.desde = desde; }
  if (hasta) { cond.push('c.fecha_limite <= @hasta'); params.hasta = hasta; }

  const generales = db.prepare(`
    SELECT
      COUNT(*) AS cantidad_cotizaciones,
      SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) AS cantidad_adjudicadas,
      SUM(c.toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN c.adjudicado = 1 THEN c.toneladas ELSE 0 END) AS toneladas_adjudicadas
    FROM cotizaciones c
    WHERE ${cond.join(' AND ')}
  `).get(params);

  const montosCotizados = totalesPorMoneda('c.monto_cotizado', cond, params);
  const montosAdjudicados = totalesPorMoneda('c.monto_adjudicado', cond, params, 'c.adjudicado = 1');

  res.json({ ...generales, montos_cotizados: montosCotizados, montos_adjudicados: montosAdjudicados });
});

// Años presentes en los datos (según F. Presentación), para poblar el selector
// del resumen anual de abajo. Se calculan desde los datos reales en vez de
// asumir un rango fijo, porque el Excel original tenía cotizaciones de varios años.
router.get('/api/dashboards/anios', (req, res) => {
  const filas = db.prepare(`
    SELECT DISTINCT substr(c.fecha_limite, 1, 4) AS anio
    FROM cotizaciones c
    WHERE c.fecha_limite IS NOT NULL AND c.fecha_limite != '' AND ${SOLO_ULTIMA_REVISION}
    ORDER BY anio DESC
  `).all().map((f) => f.anio).filter(Boolean);
  res.json(filas);
});

// Resumen fijo por año — cuánto se lleva cotizado/adjudicado (monto y
// toneladas) en el año elegido (según F. Presentación), pensado como indicador
// permanente que se puede ir consultando a lo largo del año. Mismo criterio de
// "adjudicado" y de separación por moneda que el indicador de arriba.
router.get('/api/dashboards/resumen-anual', (req, res) => {
  const anio = String(req.query.anio || '').slice(0, 4) || String(new Date().getFullYear());
  const cond = [SOLO_ULTIMA_REVISION, 'substr(c.fecha_limite, 1, 4) = @anio'];
  const params = { anio };

  const generales = db.prepare(`
    SELECT
      COUNT(*) AS cantidad_cotizaciones,
      SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) AS cantidad_adjudicadas,
      SUM(c.toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN c.adjudicado = 1 THEN c.toneladas ELSE 0 END) AS toneladas_adjudicadas
    FROM cotizaciones c
    WHERE ${cond.join(' AND ')}
  `).get(params);

  const montosCotizados = totalesPorMoneda('c.monto_cotizado', cond, params);
  const montosAdjudicados = totalesPorMoneda('c.monto_adjudicado', cond, params, 'c.adjudicado = 1');

  res.json({ anio: Number(anio), ...generales, montos_cotizados: montosCotizados, montos_adjudicados: montosAdjudicados });
});

module.exports = router;

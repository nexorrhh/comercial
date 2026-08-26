const express = require('express');
const db = require('../lib/db');

const router = express.Router();

// Cada revisión de una cotización que se reabre queda como una fila propia
// en `cotizaciones` (ver server/routes/cotizaciones.js). Sin este filtro,
// los indicadores de abajo contarían una misma oportunidad comercial una vez
// por cada vez que se reabrió — este filtro se queda sólo con la ÚLTIMA
// revisión de cada grupo, igual que hace el listado por defecto.
const SOLO_ULTIMA_REVISION = `
  NOT EXISTS (
    SELECT 1 FROM comercial_cotizaciones c2
    WHERE COALESCE(c2.cotizacion_original_id, c2.id) = COALESCE(c.cotizacion_original_id, c.id)
      AND c2.revision > c.revision
  )
`;

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

// Indicador ISO 1: toneladas cotizadas / adjudicadas / ejecutadas a lo largo del tiempo,
// agrupado por mes (reemplaza a la hoja "GRAFICOS", que dependía de refrescar un pivot a mano).
router.get('/api/dashboards/toneladas', async (req, res) => {
  const { desde, hasta, categoria_id } = req.query;
  const { params, ph } = creadorParams();
  const cond = ["c.fecha_limite IS NOT NULL", "c.fecha_limite != ''", SOLO_ULTIMA_REVISION];
  if (desde) cond.push(`c.fecha_limite >= ${ph(desde)}`);
  if (hasta) cond.push(`c.fecha_limite <= ${ph(hasta)}`);
  if (categoria_id) cond.push(`c.categoria_id = ${ph(Number(categoria_id))}`);

  const { rows } = await db.query(`
    SELECT
      substr(c.fecha_limite, 1, 7) AS periodo,
      SUM(c.toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN c.adjudicado = 1 THEN c.toneladas ELSE 0 END) AS toneladas_adjudicadas,
      SUM(COALESCE(c.toneladas_ejecutadas, 0)) AS toneladas_ejecutadas
    FROM comercial_cotizaciones c
    WHERE ${cond.join(' AND ')}
    GROUP BY periodo
    ORDER BY periodo
  `, params);
  res.json(rows);
});

// Indicador ISO 2: cantidad de cotizaciones presentadas vs. adjudicadas por categoría
// (y opcionalmente por período), es decir la tasa de éxito comercial.
// Reemplaza a la hoja "INDICADOR ISO". adjudicado = 1 sigue siendo el único valor que
// cuenta como "adjudicada" (el valor 2, "a otro proveedor", queda correctamente
// afuera sin tocar esta consulta).
router.get('/api/dashboards/tasa-adjudicacion', async (req, res) => {
  const { desde, hasta, agrupar, minimo } = req.query; // agrupar = 'categoria' (default) | 'mes'
  const minimoMuestras = Number(minimo) || 1;
  const { params, ph } = creadorParams();
  const cond = [SOLO_ULTIMA_REVISION];
  if (desde) cond.push(`c.fecha_limite >= ${ph(desde)}`);
  if (hasta) cond.push(`c.fecha_limite <= ${ph(hasta)}`);
  const where = `WHERE ${cond.join(' AND ')}`;

  const columnaAgrupacion = agrupar === 'mes'
    ? "substr(c.fecha_limite, 1, 7)"
    : "COALESCE(cat.nombre, '(sin categoría)')";

  const { rows: todas } = await db.query(`
    SELECT
      ${columnaAgrupacion} AS grupo,
      COUNT(*) AS total_cotizaciones,
      SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) AS adjudicadas,
      ROUND(100.0 * SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS tasa_adjudicacion_pct
    FROM comercial_cotizaciones c
    LEFT JOIN comercial_catalogo_categoria cat ON cat.id = c.categoria_id
    ${where}
    GROUP BY grupo
    ORDER BY total_cotizaciones DESC
  `, params);

  const filtradas = todas.filter((f) => Number(f.total_cotizaciones) >= minimoMuestras);
  res.json({
    filas: filtradas,
    ocultas_por_pocas_muestras: todas.length - filtradas.length,
  });
});

// Resumen general para la portada del dashboard
router.get('/api/dashboards/resumen', async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) AS total_cotizaciones,
      SUM(CASE WHEN adjudicado = 1 THEN 1 ELSE 0 END) AS total_adjudicadas,
      SUM(toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN adjudicado = 1 THEN toneladas ELSE 0 END) AS toneladas_adjudicadas
    FROM comercial_cotizaciones c
    WHERE ${SOLO_ULTIMA_REVISION}
  `);
  res.json(rows[0]);
});

// --- Indicador libre por Cliente/Comprador + resumen anual ---
//
// Helper compartido: suma un campo de monto (monto_cotizado o monto_adjudicado)
// agrupado por moneda, sobre el mismo WHERE que ya se armó para el resto de la
// consulta (+ una condición extra opcional, ej. "sólo adjudicadas"). Se separan
// los totales por moneda (USD/ARS) en vez de sumarlos juntos, porque mezclar
// ambas monedas en un solo número no es correcto financieramente. Las filas sin
// moneda cargada quedan agrupadas aparte, bajo moneda = null — el frontend las
// muestra como "Sin moneda especificada".
async function totalesPorMoneda(campoMonto, condBase, params, condicionExtra) {
  const cond = condBase.slice();
  if (condicionExtra) cond.push(condicionExtra);
  cond.push(`${campoMonto} IS NOT NULL`);
  const { rows } = await db.query(`
    SELECT moneda, SUM(${campoMonto}) AS total
    FROM comercial_cotizaciones c
    WHERE ${cond.join(' AND ')}
    GROUP BY moneda
  `, params);
  return rows;
}

// Indicador libre: totales de monto y toneladas, cotizado y adjudicado,
// filtrando por Cliente y/o Comprador (ambos opcionales, se pueden combinar —
// si no se manda ninguno, devuelve los totales de todo el sistema) y también
// por un rango de fechas (F. Presentación / fecha_limite, mismo campo y
// mismos nombres de parámetro "desde"/"hasta" que ya usa el resto del
// sistema en Listado y en los otros tableros). Sólo cuenta la última
// revisión de cada cotización, igual criterio que el resto de los tableros.
router.get('/api/dashboards/indicador-cliente-comprador', async (req, res) => {
  const { cliente, comprador, desde, hasta } = req.query;
  const { params, ph } = creadorParams();
  const cond = [SOLO_ULTIMA_REVISION];
  if (cliente) cond.push(`c.cliente ILIKE ${ph(`%${cliente}%`)}`);
  if (comprador) cond.push(`c.comprador ILIKE ${ph(`%${comprador}%`)}`);
  if (desde) cond.push(`c.fecha_limite >= ${ph(desde)}`);
  if (hasta) cond.push(`c.fecha_limite <= ${ph(hasta)}`);

  const { rows: generalesRows } = await db.query(`
    SELECT
      COUNT(*) AS cantidad_cotizaciones,
      SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) AS cantidad_adjudicadas,
      SUM(c.toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN c.adjudicado = 1 THEN c.toneladas ELSE 0 END) AS toneladas_adjudicadas
    FROM comercial_cotizaciones c
    WHERE ${cond.join(' AND ')}
  `, params);

  const montosCotizados = await totalesPorMoneda('c.monto_cotizado', cond, params);
  const montosAdjudicados = await totalesPorMoneda('c.monto_adjudicado', cond, params, 'c.adjudicado = 1');

  res.json({ ...generalesRows[0], montos_cotizados: montosCotizados, montos_adjudicados: montosAdjudicados });
});

// Años presentes en los datos (según F. Presentación), para poblar el selector
// del resumen anual de abajo. Se calculan desde los datos reales en vez de
// asumir un rango fijo, porque el Excel original tenía cotizaciones de varios años.
router.get('/api/dashboards/anios', async (req, res) => {
  const { rows } = await db.query(`
    SELECT DISTINCT substr(c.fecha_limite, 1, 4) AS anio
    FROM comercial_cotizaciones c
    WHERE c.fecha_limite IS NOT NULL AND c.fecha_limite != '' AND ${SOLO_ULTIMA_REVISION}
    ORDER BY anio DESC
  `);
  res.json(rows.map((f) => f.anio).filter(Boolean));
});

// Resumen fijo por año — cuánto se lleva cotizado/adjudicado (monto y
// toneladas) en el año elegido (según F. Presentación), pensado como indicador
// permanente que se puede ir consultando a lo largo del año. Mismo criterio de
// "adjudicado" y de separación por moneda que el indicador de arriba.
router.get('/api/dashboards/resumen-anual', async (req, res) => {
  const anio = String(req.query.anio || '').slice(0, 4) || String(new Date().getFullYear());
  const { params, ph } = creadorParams();
  const cond = [SOLO_ULTIMA_REVISION, `substr(c.fecha_limite, 1, 4) = ${ph(anio)}`];

  const { rows: generalesRows } = await db.query(`
    SELECT
      COUNT(*) AS cantidad_cotizaciones,
      SUM(CASE WHEN c.adjudicado = 1 THEN 1 ELSE 0 END) AS cantidad_adjudicadas,
      SUM(c.toneladas) AS toneladas_cotizadas,
      SUM(CASE WHEN c.adjudicado = 1 THEN c.toneladas ELSE 0 END) AS toneladas_adjudicadas
    FROM comercial_cotizaciones c
    WHERE ${cond.join(' AND ')}
  `, params);

  const montosCotizados = await totalesPorMoneda('c.monto_cotizado', cond, params);
  const montosAdjudicados = await totalesPorMoneda('c.monto_adjudicado', cond, params, 'c.adjudicado = 1');

  res.json({ anio: Number(anio), ...generalesRows[0], montos_cotizados: montosCotizados, montos_adjudicados: montosAdjudicados });
});

module.exports = router;

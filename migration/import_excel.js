// Importa y NORMALIZA la hoja maestra del Excel de cotizaciones a la base nueva.
// (sin cambios respecto de la v1 — ver detalle completo de las reglas de limpieza
// en la versión original de este documento; se omite acá para no repetir 150 líneas
// que no cambiaron. El archivo real en el proyecto del usuario es idéntico al
// entregado originalmente el 2026-08-20.)
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('./legacySqliteDb');

const [, , rutaArchivo, usernameImporta] = process.argv;

if (!rutaArchivo) {
  console.log('Uso: node migration/import_excel.js <ruta-al-xlsx> [username-que-importa]');
  process.exit(1);
}

const usuarioImporta = usernameImporta
  ? db.prepare('SELECT id FROM usuarios WHERE username = ?').get(usernameImporta)
  : null;
const creadoPorId = usuarioImporta ? usuarioImporta.id : null;

const TYPOS = {
  CALDEDERIA: 'CALDERERIA',
  CLADERERIA: 'CALDERERIA',
  ESTRUTURA: 'ESTRUCTURA',
};

function limpiarEspacios(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function foldKey(s) {
  let v = limpiarEspacios(s).toUpperCase();
  if (TYPOS[v]) v = TYPOS[v];
  return v;
}

function construirCatalogo(valores) {
  const grupos = new Map();
  for (const raw of valores) {
    if (raw === null || raw === undefined) continue;
    const limpio = limpiarEspacios(raw);
    if (!limpio) continue;
    const key = foldKey(limpio);
    if (!grupos.has(key)) grupos.set(key, new Map());
    const m = grupos.get(key);
    m.set(limpio, (m.get(limpio) || 0) + 1);
  }
  const catalogo = new Map();
  for (const [key, variantesMap] of grupos) {
    const variantes = [...variantesMap.entries()].map(([texto, count]) => ({ texto, count }));
    variantes.sort((a, b) => b.count - a.count);
    catalogo.set(key, { canonico: variantes[0].texto, variantes });
  }
  return catalogo;
}

function parsearFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    return valor.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function main() {
  const wb = XLSX.readFile(rutaArchivo, { cellDates: true });
  const hoja = wb.Sheets['VersionesDeObras-proyectos13 9 '];
  if (!hoja) {
    console.error('No se encontró la hoja "VersionesDeObras-proyectos13 9 ". Hojas disponibles:', wb.SheetNames);
    process.exit(1);
  }
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
  const datos = filas.slice(1).filter((f) => f[1] !== null && f[1] !== undefined && String(f[1]).trim() !== '');

  console.log(`Filas con datos detectadas: ${datos.length}`);

  const categorias = construirCatalogo(datos.map((f) => f[12]));
  const cotizadores = construirCatalogo(datos.map((f) => f[4]));

  const insertCategoria = db.prepare('INSERT OR IGNORE INTO catalogo_categoria (nombre) VALUES (?)');
  const getCategoriaId = db.prepare('SELECT id FROM catalogo_categoria WHERE nombre = ?');
  const insertCotizador = db.prepare('INSERT OR IGNORE INTO catalogo_cotizador (iniciales) VALUES (?)');
  const getCotizadorId = db.prepare('SELECT id FROM catalogo_cotizador WHERE iniciales = ?');
  const getEstadoId = db.prepare('SELECT id FROM catalogo_estado WHERE codigo = ?');

  const catCategoriaId = new Map();
  for (const { canonico } of categorias.values()) {
    insertCategoria.run(canonico);
    catCategoriaId.set(canonico, getCategoriaId.get(canonico).id);
  }
  const catCotizadorId = new Map();
  for (const { canonico } of cotizadores.values()) {
    insertCotizador.run(canonico);
    catCotizadorId.set(canonico, getCotizadorId.get(canonico).id);
  }

  const estadoIdPorCodigo = {
    C: getEstadoId.get('C').id,
    NC: getEstadoId.get('NC').id,
    P: getEstadoId.get('P').id,
  };

  const insertCotizacion = db.prepare(`
    INSERT INTO cotizaciones (
      fecha_recepcion, nombre, cliente, fecha_limite, cotizador_id, observaciones,
      comprador, estado_id, adjudicado, numero_oferta, ot, toneladas, categoria_id,
      creado_por_id, actualizado_por_id, origen
    ) VALUES (
      @fecha_recepcion, @nombre, @cliente, @fecha_limite, @cotizador_id, @observaciones,
      @comprador, @estado_id, @adjudicado, @numero_oferta, @ot, @toneladas, @categoria_id,
      @creado_por_id, @creado_por_id, 'migracion_excel'
    )
  `);

  const filasParaRevisar = [];
  let importadas = 0;

  db.exec('BEGIN');
  try {
    for (const f of datos) {
      const [recepcion, nombre, cliente, fechaLimite, cotizaRaw, obs, comprador, estadoRaw, adjRaw, oferta, ot, ton, categoriaRaw] = f;

      const categoriaLimpia = categoriaRaw ? limpiarEspacios(categoriaRaw) : null;
      const categoriaId = categoriaLimpia ? catCategoriaId.get(categorias.get(foldKey(categoriaLimpia)).canonico) : null;

      const cotizaLimpio = cotizaRaw ? limpiarEspacios(cotizaRaw) : null;
      let cotizadorId = null;
      let observacionesFinal = obs || '';
      if (cotizaLimpio) {
        if (/^[A-ZÁÉÍÓÚÑ.\s/]+$/i.test(cotizaLimpio) && cotizaLimpio.length <= 15) {
          cotizadorId = catCotizadorId.get(cotizadores.get(foldKey(cotizaLimpio)).canonico);
          if (cotizaLimpio.includes('/')) {
            filasParaRevisar.push({ nombre, motivo: `COTIZA con múltiples responsables: "${cotizaLimpio}"` });
          }
        } else {
          filasParaRevisar.push({ nombre, motivo: `Valor de COTIZA sospechoso: "${cotizaLimpio}" (se guardó en observaciones, no se asignó cotizador)` });
          observacionesFinal = `[COTIZA original: ${cotizaLimpio}] ${observacionesFinal}`.trim();
        }
      }

      const estadoCodigo = estadoRaw ? limpiarEspacios(estadoRaw).toUpperCase() : null;
      const estadoId = estadoCodigo && estadoIdPorCodigo[estadoCodigo] ? estadoIdPorCodigo[estadoCodigo] : null;
      if (estadoCodigo && !estadoIdPorCodigo[estadoCodigo]) {
        filasParaRevisar.push({ nombre, motivo: `Estado desconocido: "${estadoRaw}"` });
      }

      const adjudicado = adjRaw && limpiarEspacios(adjRaw).toUpperCase() === 'SI' ? 1 : 0;

      insertCotizacion.run({
        fecha_recepcion: parsearFecha(recepcion),
        nombre: limpiarEspacios(nombre),
        cliente: cliente ? limpiarEspacios(cliente) : null,
        fecha_limite: parsearFecha(fechaLimite),
        cotizador_id: cotizadorId,
        observaciones: observacionesFinal || null,
        comprador: comprador ? limpiarEspacios(comprador) : null,
        estado_id: estadoId,
        adjudicado,
        numero_oferta: oferta ? String(oferta) : null,
        ot: ot ? String(ot) : null,
        toneladas: typeof ton === 'number' ? ton : (ton ? Number(String(ton).replace(',', '.')) || null : null),
        categoria_id: categoriaId,
        creado_por_id: creadoPorId,
      });
      importadas += 1;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log(`Cotizaciones importadas: ${importadas}`);
  console.log(`Categorías distintas creadas en el catálogo: ${catCategoriaId.size}`);
  console.log(`Cotizadores distintos creados en el catálogo: ${catCotizadorId.size}`);

  const reporte = {
    generado_en: new Date().toISOString(),
    categorias_agrupadas: [...categorias.entries()]
      .filter(([, v]) => v.variantes.length > 1)
      .map(([, v]) => ({ canonico: v.canonico, variantes: v.variantes })),
    cotizadores_agrupados: [...cotizadores.entries()]
      .filter(([, v]) => v.variantes.length > 1)
      .map(([, v]) => ({ canonico: v.canonico, variantes: v.variantes })),
    filas_para_revisar: filasParaRevisar,
  };
  const rutaReporte = path.join(__dirname, '..', 'data', 'reporte_importacion.json');
  fs.writeFileSync(rutaReporte, JSON.stringify(reporte, null, 2), 'utf8');
  console.log(`Reporte de normalización guardado en: ${rutaReporte}`);
  console.log(`Filas marcadas para revisión manual: ${filasParaRevisar.length}`);
}

main();

const db = require('./db');

const insertHistorial = db.prepare(`
  INSERT INTO historial_cambios (cotizacion_id, usuario_id, campo, valor_anterior, valor_nuevo, accion, fecha)
  VALUES (@cotizacion_id, @usuario_id, @campo, @valor_anterior, @valor_nuevo, @accion, datetime('now'))
`);

function normalizar(v) {
  if (v === undefined || v === null) return null;
  return String(v);
}

/**
 * Compara "antes" y "despues" (objetos con las mismas claves = columnas de cotizaciones)
 * y graba un renglón de historial por cada campo que haya cambiado.
 * Si accion es 'create' o 'delete', graba un único renglón resumen.
 */
function registrarCambios(db_, { cotizacionId, usuarioId, antes, despues, accion = 'update' }) {
  const tx = db.transaction(() => {
    if (accion === 'create') {
      insertHistorial.run({
        cotizacion_id: cotizacionId,
        usuario_id: usuarioId,
        campo: '(alta)',
        valor_anterior: null,
        valor_nuevo: 'Cotización creada',
        accion: 'create',
      });
      return;
    }
    if (accion === 'delete') {
      insertHistorial.run({
        cotizacion_id: cotizacionId,
        usuario_id: usuarioId,
        campo: '(baja)',
        valor_anterior: 'activa',
        valor_nuevo: 'eliminada',
        accion: 'delete',
      });
      return;
    }
    const claves = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
    for (const campo of claves) {
      const a = normalizar(antes ? antes[campo] : null);
      const d = normalizar(despues ? despues[campo] : null);
      if (a !== d) {
        insertHistorial.run({
          cotizacion_id: cotizacionId,
          usuario_id: usuarioId,
          campo,
          valor_anterior: a,
          valor_nuevo: d,
          accion: 'update',
        });
      }
    }
  });
  tx();
}

// Actualización 5: registra en el historial la creación de una revisión, tanto en
// la fila nueva (para que su historial explique de dónde viene) como en la fila
// de la que se generó (para que quien mire la cotización "vieja" vea que se abrió
// una revisión nueva y no se quede pensando que quedó abandonada).
function registrarRevision(db_, { cotizacionOrigenId, cotizacionNuevaId, usuarioId, revisionAnterior, revisionNueva, motivo }) {
  const tx = db.transaction(() => {
    insertHistorial.run({
      cotizacion_id: cotizacionNuevaId,
      usuario_id: usuarioId,
      campo: '(revisión)',
      valor_anterior: `Rev. ${revisionAnterior} (cotización #${cotizacionOrigenId})`,
      valor_nuevo: `Rev. ${revisionNueva}: ${motivo}`,
      accion: 'create',
    });
    insertHistorial.run({
      cotizacion_id: cotizacionOrigenId,
      usuario_id: usuarioId,
      campo: '(revisión)',
      valor_anterior: `Rev. ${revisionAnterior}`,
      valor_nuevo: `Se generó la Rev. ${revisionNueva} (motivo: ${motivo})`,
      accion: 'update',
    });
  });
  tx();
}

module.exports = { registrarCambios, registrarRevision };

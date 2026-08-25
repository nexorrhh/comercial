const db = require('./db');

function normalizar(v) {
  if (v === undefined || v === null) return null;
  return String(v);
}

async function insertarHistorial(client, { cotizacionId, usuarioId, campo, valorAnterior, valorNuevo, accion }) {
  await client.query(
    `INSERT INTO historial_cambios (cotizacion_id, usuario_id, campo, valor_anterior, valor_nuevo, accion, fecha)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [cotizacionId, usuarioId, campo, valorAnterior, valorNuevo, accion],
  );
}

/**
 * Compara "antes" y "despues" (objetos con las mismas claves = columnas de cotizaciones)
 * y graba un renglón de historial por cada campo que haya cambiado.
 * Si accion es 'create' o 'delete', graba un único renglón resumen.
 */
async function registrarCambios(db_, { cotizacionId, usuarioId, antes, despues, accion = 'update' }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (accion === 'create') {
      await insertarHistorial(client, {
        cotizacionId, usuarioId, campo: '(alta)', valorAnterior: null, valorNuevo: 'Cotización creada', accion: 'create',
      });
    } else if (accion === 'delete') {
      await insertarHistorial(client, {
        cotizacionId, usuarioId, campo: '(baja)', valorAnterior: 'activa', valorNuevo: 'eliminada', accion: 'delete',
      });
    } else {
      const claves = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
      for (const campo of claves) {
        const a = normalizar(antes ? antes[campo] : null);
        const d = normalizar(despues ? despues[campo] : null);
        if (a !== d) {
          await insertarHistorial(client, {
            cotizacionId, usuarioId, campo, valorAnterior: a, valorNuevo: d, accion: 'update',
          });
        }
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Registra en el historial la creación de una revisión, tanto en la fila
// nueva (para que su historial explique de dónde viene) como en la fila de la
// que se generó (para que quien mire la cotización "vieja" vea que se abrió
// una revisión nueva y no se quede pensando que quedó abandonada).
async function registrarRevision(db_, { cotizacionOrigenId, cotizacionNuevaId, usuarioId, revisionAnterior, revisionNueva, motivo }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await insertarHistorial(client, {
      cotizacionId: cotizacionNuevaId,
      usuarioId,
      campo: '(revisión)',
      valorAnterior: `Rev. ${revisionAnterior} (cotización #${cotizacionOrigenId})`,
      valorNuevo: `Rev. ${revisionNueva}: ${motivo}`,
      accion: 'create',
    });
    await insertarHistorial(client, {
      cotizacionId: cotizacionOrigenId,
      usuarioId,
      campo: '(revisión)',
      valorAnterior: `Rev. ${revisionAnterior}`,
      valorNuevo: `Se generó la Rev. ${revisionNueva} (motivo: ${motivo})`,
      accion: 'update',
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { registrarCambios, registrarRevision };

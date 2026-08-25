// Backfill de la Actualización 2: completa modo_entrega_id ("Cotiza por" desde la
// Actualización 3) para las cotizaciones migradas del Excel que tienen Observaciones
// pero no tienen este dato, buscando las palabras "mail" o "portal" en el texto.
// No toca filas ambiguas (mencionan ambas palabras) ni filas sin ninguna de las dos.
// No borra ni modifica el texto de Observaciones — el dato queda además visible ahí.
//
// Uso:
//   node migration/inferir_modo_envio.js            (modo simulación: sólo informa)
//   node migration/inferir_modo_envio.js --aplicar   (aplica los cambios)
const db = require('../server/lib/db');

const aplicar = process.argv.includes('--aplicar');

const modoEntregaIdPorNombre = {};
for (const fila of db.prepare('SELECT id, nombre FROM catalogo_modo_entrega').all()) {
  modoEntregaIdPorNombre[fila.nombre] = fila.id;
}

const candidatas = db.prepare(`
  SELECT id, observaciones FROM cotizaciones
  WHERE modo_entrega_id IS NULL
    AND observaciones IS NOT NULL
    AND TRIM(observaciones) != ''
`).all();

let mail = 0, portal = 0, ambiguas = 0, sinCoincidencia = 0;
const update = db.prepare('UPDATE cotizaciones SET modo_entrega_id = ? WHERE id = ?');

const tx = db.transaction(() => {
  for (const fila of candidatas) {
    const texto = fila.observaciones.toLowerCase();
    const tieneMail = /\bmail\b/.test(texto);
    const tienePortal = /\bportal\b/.test(texto);

    if (tieneMail && tienePortal) { ambiguas += 1; continue; }
    if (tieneMail) {
      mail += 1;
      if (aplicar) update.run(modoEntregaIdPorNombre['Mail'], fila.id);
      continue;
    }
    if (tienePortal) {
      portal += 1;
      if (aplicar) update.run(modoEntregaIdPorNombre['Portal'], fila.id);
      continue;
    }
    sinCoincidencia += 1;
  }
});
tx();

console.log(`Filas con observaciones y sin modo de entrega: ${candidatas.length}`);
console.log(`  -> Mail: ${mail}`);
console.log(`  -> Portal: ${portal}`);
console.log(`  -> Ambiguas (mencionan ambas, no se tocaron): ${ambiguas}`);
console.log(`  -> Sin ninguna palabra clave (no se tocaron): ${sinCoincidencia}`);
console.log(aplicar ? 'Cambios aplicados.' : 'Modo simulación: no se guardó nada. Correr con --aplicar para aplicar de verdad.');

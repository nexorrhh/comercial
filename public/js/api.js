// Pequeño wrapper de fetch para hablar con la API propia.
async function api(metodo, url, body) {
  const opciones = {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opciones.body = JSON.stringify(body);
  const resp = await fetch(url, opciones);
  const contentType = resp.headers.get('content-type') || '';
  const datos = contentType.includes('application/json') ? await resp.json() : null;
  if (!resp.ok) {
    const mensaje = (datos && datos.error) || `Error ${resp.status}`;
    throw new Error(mensaje);
  }
  return datos;
}

function fmtFecha(iso) {
  if (!iso) return '';
  const partes = String(iso).slice(0, 10).split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// --- Formato argentino de montos (Actualización 11: separador de miles) ----
//
// Compartido por ficha.js (campos editables de la ficha) y comercial.js (columna
// de sólo lectura), para que el mismo número siempre se vea/escriba igual en
// todo el sistema: punto de miles, coma decimal (ej. "8.850.000,15"). indicadores.js
// y dashboards.js ya tenían su propia versión de este formateo desde las
// Actualizaciones 8/9 (sólo para mostrar, no para inputs editables) y siguen
// como estaban, para no tocar pantallas que ya andaban bien.

// Da formato "8.850.000,15" a un número. Devuelve '' para null/undefined/NaN,
// para que un campo vacío se vea vacío en vez de "0,00".
function fmtMontoAr(n) {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Convierte lo que haya tipeado la persona ("8.850.000,15", "8850000.15",
// "8850000,15", "8850000") de vuelta a un Number (o null si está vacío / no se
// pudo interpretar). Regla: si aparecen coma Y punto, el separador decimal es
// el que está más a la derecha (el otro se asume de miles y se descarta); si
// sólo aparece coma, es decimal; si sólo aparece punto, se asume decimal nada
// más cuando hay un único punto con 1-2 dígitos después (ej. "8850000.15") —
// si no, se asume separador de miles (ej. "8.850.000").
function parsearMontoAr(valor) {
  if (valor === null || valor === undefined) return null;
  let s = String(valor).trim();
  if (!s) return null;
  const negativo = s.startsWith('-');
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  let normalizado;
  if (tieneComa && tienePunto) {
    normalizado = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (tieneComa) {
    normalizado = s.replace(/\./g, '').replace(',', '.');
  } else if (tienePunto) {
    const partes = s.split('.');
    const pareceDecimal = partes.length === 2 && partes[1].length <= 2;
    normalizado = pareceDecimal ? s : s.replace(/\./g, '');
  } else {
    normalizado = s;
  }
  const n = parseFloat(normalizado);
  if (Number.isNaN(n)) return null;
  return negativo ? -n : n;
}

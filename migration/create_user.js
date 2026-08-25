// Crea (o actualiza la contraseña de) un usuario desde la línea de comandos.
// Uso: node migration/create_user.js <username> <password> "<Nombre Completo>" <rol>
// rol: admin | gerencia | comercial | lectura
const bcrypt = require('bcryptjs');
const db = require('../server/lib/db');

const [, , username, password, nombreCompleto, rol] = process.argv;

if (!username || !password || !nombreCompleto || !rol) {
  console.log('Uso: node migration/create_user.js <username> <password> "<Nombre Completo>" <rol>');
  console.log('Roles válidos: admin, gerencia, comercial, lectura');
  process.exit(1);
}

if (!['admin', 'gerencia', 'comercial', 'lectura'].includes(rol)) {
  console.error('Rol inválido:', rol);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const existente = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);

if (existente) {
  db.prepare('UPDATE usuarios SET password_hash = ?, nombre_completo = ?, rol = ?, activo = 1 WHERE id = ?')
    .run(hash, nombreCompleto, rol, existente.id);
  console.log(`Usuario "${username}" actualizado (rol: ${rol}).`);
} else {
  db.prepare('INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (?, ?, ?, ?)')
    .run(username, hash, nombreCompleto, rol);
  console.log(`Usuario "${username}" creado (rol: ${rol}).`);
}

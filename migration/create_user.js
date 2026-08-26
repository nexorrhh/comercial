// Crea (o actualiza el rol/contraseña de) un usuario directamente en Supabase
// Auth + tabla perfiles. Pensado sobre todo para el primer admin: la API
// /api/usuarios ya requiere estar logueado como admin, así que hace falta
// este bypass para el arranque inicial.
// Uso: node migration/create_user.js <email> <password> "<Nombre Completo>" <rol>
// rol: admin | gerencia | comercial | lectura
require('dotenv').config();
const db = require('../server/lib/db');
const supabaseAdmin = require('../server/lib/supabaseAdmin');

const [, , email, password, nombreCompleto, rol] = process.argv;

if (!email || !password || !nombreCompleto || !rol) {
  console.log('Uso: node migration/create_user.js <email> <password> "<Nombre Completo>" <rol>');
  console.log('Roles válidos: admin, gerencia, comercial, lectura');
  process.exit(1);
}

if (!['admin', 'gerencia', 'comercial', 'lectura'].includes(rol)) {
  console.error('Rol inválido:', rol);
  process.exit(1);
}

async function main() {
  const { data: existentes, error: errorLista } = await supabaseAdmin.auth.admin.listUsers();
  if (errorLista) throw errorLista;
  const existente = existentes.users.find((u) => u.email === email);

  let userId;
  if (existente) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existente.id, { password });
    if (error) throw error;
    userId = existente.id;
    console.log(`Usuario de Auth "${email}" ya existía: se actualizó la contraseña.`);
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`Usuario de Auth "${email}" creado.`);
  }

  await db.query(
    `INSERT INTO comercial_perfiles (id, email, nombre_completo, rol, activo)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (id) DO UPDATE SET email = $2, nombre_completo = $3, rol = $4, activo = true`,
    [userId, email, nombreCompleto, rol],
  );
  console.log(`Perfil "${email}" listo (rol: ${rol}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error creando el usuario:', err.message || err);
  process.exit(1);
});

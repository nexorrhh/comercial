const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const supabaseAdmin = require('../lib/supabaseAdmin');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Sólo el admin gestiona usuarios (altas/roles).
router.get('/api/usuarios', requireRole('admin'), async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, email, nombre_completo, rol, activo, debe_crear_password, creado_en FROM comercial_perfiles ORDER BY nombre_completo',
  );
  res.json(rows);
});

// El password es opcional: si no se manda, la cuenta queda pendiente de que
// la propia persona cree su contraseña la primera vez que intente entrar
// (ver /login/estado-email y /login/crear-password en routes/auth.js).
router.post('/api/usuarios', requireRole('admin'), async (req, res) => {
  const { email, password, nombre_completo, rol } = req.body;
  if (!email || !nombre_completo || !rol) {
    return res.status(400).json({ error: 'Faltan datos (email, nombre_completo, rol)' });
  }
  if (!['admin', 'gerencia', 'comercial', 'lectura'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  const debeCrearPassword = !password;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    // Si no se dio contraseña, se genera una imposible de adivinar: nadie la
    // conoce ni la necesita, porque debe_crear_password fuerza el flujo de
    // "crear tu contraseña" en el primer intento de login.
    password: password || crypto.randomBytes(24).toString('hex'),
    email_confirm: true,
  });
  if (error) {
    return res.status(400).json({ error: error.message || 'No se pudo crear el usuario' });
  }

  try {
    await db.query(
      'INSERT INTO comercial_perfiles (id, email, nombre_completo, rol, debe_crear_password) VALUES ($1, $2, $3, $4, $5)',
      [data.user.id, email, nombre_completo, rol, debeCrearPassword],
    );
  } catch (e) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    return res.status(400).json({ error: 'No se pudo crear el perfil del usuario' });
  }

  res.status(201).json({ id: data.user.id });
});

router.put('/api/usuarios/:id', requireRole('admin'), async (req, res) => {
  const { nombre_completo, rol, activo, password, email } = req.body;
  const { rows } = await db.query('SELECT * FROM comercial_perfiles WHERE id = $1', [req.params.id]);
  const existente = rows[0];
  if (!existente) return res.status(404).json({ error: 'No encontrado' });

  // Cambiar el email reutiliza la MISMA cuenta (mismo id) — no crea una
  // nueva — para no perder el vínculo con las cotizaciones/historial que ya
  // la referencian como creador/responsable/editor.
  if (email && email !== existente.email) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { email, email_confirm: true });
    if (error) return res.status(400).json({ error: error.message || 'No se pudo actualizar el email' });
  }

  // Si se corrige el email pero no se manda una contraseña nueva en el
  // mismo pedido, la cuenta queda pendiente de que la persona cree la suya
  // al entrar (típico caso: usuario migrado con email de relleno).
  const debeCrearPassword = email && email !== existente.email && !password ? true : (password ? false : null);

  await db.query(
    `UPDATE comercial_perfiles SET
       email = COALESCE($1, email),
       nombre_completo = COALESCE($2, nombre_completo),
       rol = COALESCE($3, rol),
       activo = COALESCE($4, activo),
       debe_crear_password = COALESCE($5, debe_crear_password)
     WHERE id = $6`,
    [email ?? null, nombre_completo ?? null, rol ?? null, activo === undefined ? null : Boolean(activo), debeCrearPassword, req.params.id],
  );

  if (password) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { password });
    if (error) return res.status(400).json({ error: error.message || 'No se pudo actualizar la contraseña' });
  }
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const db = require('../lib/db');
const supabaseAdmin = require('../lib/supabaseAdmin');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Sólo el admin gestiona usuarios (altas/roles).
router.get('/api/usuarios', requireRole('admin'), async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, email, nombre_completo, rol, activo, creado_en FROM perfiles ORDER BY nombre_completo',
  );
  res.json(rows);
});

router.post('/api/usuarios', requireRole('admin'), async (req, res) => {
  const { email, password, nombre_completo, rol } = req.body;
  if (!email || !password || !nombre_completo || !rol) {
    return res.status(400).json({ error: 'Faltan datos (email, password, nombre_completo, rol)' });
  }
  if (!['admin', 'gerencia', 'comercial', 'lectura'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    return res.status(400).json({ error: error.message || 'No se pudo crear el usuario' });
  }

  try {
    await db.query(
      'INSERT INTO perfiles (id, email, nombre_completo, rol) VALUES ($1, $2, $3, $4)',
      [data.user.id, email, nombre_completo, rol],
    );
  } catch (e) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    return res.status(400).json({ error: 'No se pudo crear el perfil del usuario' });
  }

  res.status(201).json({ id: data.user.id });
});

router.put('/api/usuarios/:id', requireRole('admin'), async (req, res) => {
  const { nombre_completo, rol, activo, password } = req.body;
  const { rows } = await db.query('SELECT * FROM perfiles WHERE id = $1', [req.params.id]);
  const existente = rows[0];
  if (!existente) return res.status(404).json({ error: 'No encontrado' });

  await db.query(
    `UPDATE perfiles SET
       nombre_completo = COALESCE($1, nombre_completo),
       rol = COALESCE($2, rol),
       activo = COALESCE($3, activo)
     WHERE id = $4`,
    [nombre_completo ?? null, rol ?? null, activo === undefined ? null : Boolean(activo), req.params.id],
  );

  if (password) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, { password });
    if (error) return res.status(400).json({ error: error.message || 'No se pudo actualizar la contraseña' });
  }
  res.json({ ok: true });
});

module.exports = router;

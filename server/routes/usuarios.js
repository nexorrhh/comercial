const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Sólo el admin gestiona usuarios (altas/roles).
router.get('/api/usuarios', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, username, nombre_completo, rol, activo, creado_en FROM usuarios ORDER BY nombre_completo').all());
});

router.post('/api/usuarios', requireRole('admin'), (req, res) => {
  const { username, password, nombre_completo, rol } = req.body;
  if (!username || !password || !nombre_completo || !rol) {
    return res.status(400).json({ error: 'Faltan datos (username, password, nombre_completo, rol)' });
  }
  if (!['admin', 'gerencia', 'comercial', 'lectura'].includes(rol)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare(`
      INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (?, ?, ?, ?)
    `).run(username, hash, nombre_completo, rol);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Ese usuario ya existe' });
  }
});

router.put('/api/usuarios/:id', requireRole('admin'), (req, res) => {
  const { nombre_completo, rol, activo, password } = req.body;
  const existente = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!existente) return res.status(404).json({ error: 'No encontrado' });

  db.prepare(`
    UPDATE usuarios SET
      nombre_completo = COALESCE(?, nombre_completo),
      rol = COALESCE(?, rol),
      activo = COALESCE(?, activo)
    WHERE id = ?
  `).run(nombre_completo ?? null, rol ?? null, activo === undefined ? null : (activo ? 1 : 0), req.params.id);

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  }
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/api/catalogos/categorias', requireRole('admin'), (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  try {
    const info = db.prepare('INSERT INTO catalogo_categoria (nombre) VALUES (?)').run(nombre.trim());
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Esa categoría ya existe' });
  }
});

router.post('/api/catalogos/cotizadores', requireRole('admin'), (req, res) => {
  const { iniciales, nombre_completo } = req.body;
  if (!iniciales) return res.status(400).json({ error: 'Faltan las iniciales' });
  try {
    const info = db.prepare('INSERT INTO catalogo_cotizador (iniciales, nombre_completo) VALUES (?, ?)')
      .run(iniciales.trim(), nombre_completo || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Esas iniciales ya existen' });
  }
});

module.exports = router;

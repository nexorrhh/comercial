const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/api/catalogos/categorias', requireRole('admin'), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  try {
    const { rows } = await db.query(
      'INSERT INTO comercial_catalogo_categoria (nombre) VALUES ($1) RETURNING id',
      [nombre.trim()],
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    res.status(400).json({ error: 'Esa categoría ya existe' });
  }
});

router.post('/api/catalogos/cotizadores', requireRole('admin'), async (req, res) => {
  const { iniciales, nombre_completo } = req.body;
  if (!iniciales) return res.status(400).json({ error: 'Faltan las iniciales' });
  try {
    const { rows } = await db.query(
      'INSERT INTO comercial_catalogo_cotizador (iniciales, nombre_completo) VALUES ($1, $2) RETURNING id',
      [iniciales.trim(), nombre_completo || null],
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    res.status(400).json({ error: 'Esas iniciales ya existen' });
  }
});

module.exports = router;

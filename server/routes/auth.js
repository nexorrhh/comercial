const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const registrarAcceso = db.prepare(
    'INSERT INTO log_accesos (usuario_id, exito, ip) VALUES (?, ?, ?)'
  );
  const usuario = db
    .prepare('SELECT * FROM usuarios WHERE username = ? AND activo = 1')
    .get(username || '');

  const ip = req.ip;
  if (!usuario || !bcrypt.compareSync(password || '', usuario.password_hash)) {
    if (usuario) registrarAcceso.run(usuario.id, 0, ip);
    return res.status(401).render('login', { error: 'Usuario o contraseña incorrectos' });
  }

  registrarAcceso.run(usuario.id, 1, ip);
  req.session.usuario = {
    id: usuario.id,
    username: usuario.username,
    nombre_completo: usuario.nombre_completo,
    rol: usuario.rol,
  };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;

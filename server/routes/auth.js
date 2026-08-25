const express = require('express');
const db = require('../lib/db');
const supabaseAuth = require('../lib/supabaseAuth');
const { setSessionCookies, clearSessionCookies } = require('../lib/cookies');
const { requireLogin, obtenerUsuarioDesdeCookies } = require('../middleware/auth');

const router = express.Router();

router.get('/login', async (req, res) => {
  const usuario = await obtenerUsuarioDesdeCookies(req, res);
  if (usuario) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).render('login', { error: 'Faltan el email o la contraseña' });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    await db.query('INSERT INTO log_accesos (usuario_id, exito, ip) VALUES (NULL, 0, $1)', [req.ip]);
    return res.status(401).render('login', { error: 'Email o contraseña incorrectos' });
  }

  const { rows } = await db.query('SELECT activo FROM perfiles WHERE id = $1', [data.user.id]);
  if (!rows[0] || !rows[0].activo) {
    return res.status(401).render('login', { error: 'Tu usuario no está activo. Consultá a un administrador.' });
  }

  setSessionCookies(res, data.session);
  await db.query('INSERT INTO log_accesos (usuario_id, exito, ip) VALUES ($1, 1, $2)', [data.user.id, req.ip]);
  res.redirect('/');
});

router.post('/logout', requireLogin, async (req, res) => {
  clearSessionCookies(res);
  res.redirect('/login');
});

module.exports = router;

const express = require('express');
const db = require('../lib/db');
const supabaseAuth = require('../lib/supabaseAuth');
const supabaseAdmin = require('../lib/supabaseAdmin');
const { setSessionCookies, clearSessionCookies } = require('../lib/cookies');
const { requireLogin, obtenerUsuarioDesdeCookies } = require('../middleware/auth');

const router = express.Router();

// El login es de 3 pantallas posibles, todas la misma vista (views/login.ejs)
// según el local "modo":
//   'email'          - sólo pide el email (paso inicial)
//   'password'       - ya sabemos el email, pide la contraseña habitual
//   'crear-password' - cuenta pendiente (migrada o con email recién
//                      corregido por un admin, sin contraseña propia todavía)

router.get('/login', async (req, res) => {
  const usuario = await obtenerUsuarioDesdeCookies(req, res);
  if (usuario) return res.redirect('/');
  res.render('login', { modo: 'email', email: '', error: null });
});

// Paso 1: sólo el email. Según el estado de la cuenta, muestra el
// formulario de contraseña habitual o el de "crear tu contraseña". Para
// emails que no existen se muestra igual el formulario de contraseña
// habitual (y el login de siempre fallará con el error genérico de
// siempre), para no revelar qué emails están dados de alta.
router.post('/login/continuar', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).render('login', { modo: 'email', email: '', error: 'Ingresá tu email' });

  const { rows } = await db.query(
    'SELECT debe_crear_password FROM comercial_perfiles WHERE email = $1 AND activo = true',
    [email],
  );
  const modo = rows[0]?.debe_crear_password ? 'crear-password' : 'password';
  res.render('login', { modo, email, error: null });
});

// Paso 2 (sólo cuando el paso 1 dio modo 'crear-password'): la persona fija
// su propia contraseña por primera vez. No hace falta que conozca ninguna
// contraseña anterior — la autorización viene de que el email coincide con
// una cuenta marcada como pendiente, que sólo un admin pudo haber dejado en
// ese estado.
router.post('/login/crear-password', async (req, res) => {
  const { email, password, confirmar } = req.body;

  const conError = (msg) => res.status(400).render('login', { modo: 'crear-password', email: email || '', error: msg });

  if (!email || !password || !confirmar) return conError('Completá todos los campos');
  if (password !== confirmar) return conError('Las contraseñas no coinciden');
  if (password.length < 8) return conError('La contraseña tiene que tener al menos 8 caracteres');

  const { rows } = await db.query(
    'SELECT id, activo, debe_crear_password FROM comercial_perfiles WHERE email = $1',
    [email],
  );
  const perfil = rows[0];
  if (!perfil || !perfil.activo || !perfil.debe_crear_password) {
    return conError('No se pudo crear la contraseña. Pedile a un administrador que revise tu usuario.');
  }

  const { error: errorUpdate } = await supabaseAdmin.auth.admin.updateUserById(perfil.id, { password });
  if (errorUpdate) return conError('No se pudo guardar la contraseña: ' + (errorUpdate.message || ''));

  await db.query('UPDATE comercial_perfiles SET debe_crear_password = false WHERE id = $1', [perfil.id]);

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    // La contraseña quedó guardada igual; que entre por el login normal.
    return res.render('login', { modo: 'password', email, error: null });
  }
  setSessionCookies(res, data.session);
  await db.query('INSERT INTO comercial_log_accesos (usuario_id, exito, ip) VALUES ($1, 1, $2)', [data.user.id, req.ip]);
  res.redirect('/');
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).render('login', { modo: 'email', email: email || '', error: 'Faltan el email o la contraseña' });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    await db.query('INSERT INTO comercial_log_accesos (usuario_id, exito, ip) VALUES (NULL, 0, $1)', [req.ip]);
    return res.status(401).render('login', { modo: 'password', email, error: 'Email o contraseña incorrectos' });
  }

  const { rows } = await db.query('SELECT activo FROM comercial_perfiles WHERE id = $1', [data.user.id]);
  if (!rows[0] || !rows[0].activo) {
    return res.status(401).render('login', { modo: 'email', email: '', error: 'Tu usuario no está activo. Consultá a un administrador.' });
  }

  setSessionCookies(res, data.session);
  await db.query('INSERT INTO comercial_log_accesos (usuario_id, exito, ip) VALUES ($1, 1, $2)', [data.user.id, req.ip]);
  res.redirect('/');
});

router.post('/logout', requireLogin, async (req, res) => {
  clearSessionCookies(res);
  res.redirect('/login');
});

module.exports = router;

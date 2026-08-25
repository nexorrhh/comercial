const db = require('../lib/db');
const supabaseAdmin = require('../lib/supabaseAdmin');
const { COOKIE_ACCESS, COOKIE_REFRESH, setSessionCookies, clearSessionCookies } = require('../lib/cookies');

// Valida las cookies de sesión (tokens de Supabase Auth) y devuelve el perfil
// de negocio (rol, nombre, activo) del usuario logueado, o null si no hay
// sesión válida. Si el access token expiró pero el refresh token todavía
// sirve, lo renueva y reescribe las cookies en la respuesta.
async function obtenerUsuarioDesdeCookies(req, res) {
  let accessToken = req.cookies?.[COOKIE_ACCESS];
  const refreshToken = req.cookies?.[COOKIE_REFRESH];
  if (!accessToken && !refreshToken) return null;

  let authUser = null;
  if (accessToken) {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (!error) authUser = data.user;
  }

  if (!authUser && refreshToken) {
    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      clearSessionCookies(res);
      return null;
    }
    setSessionCookies(res, data.session);
    authUser = data.user;
  }

  if (!authUser) return null;

  const { rows } = await db.query(
    'SELECT id, email, nombre_completo, rol, activo FROM perfiles WHERE id = $1',
    [authUser.id],
  );
  const perfil = rows[0];
  if (!perfil || !perfil.activo) return null;

  return { id: perfil.id, email: perfil.email, nombre_completo: perfil.nombre_completo, rol: perfil.rol };
}

async function requireLogin(req, res, next) {
  const usuario = await obtenerUsuarioDesdeCookies(req, res);
  if (!usuario) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    return res.redirect('/login');
  }
  req.usuario = usuario;
  next();
}

function requireRole(...roles) {
  return async (req, res, next) => {
    const usuario = req.usuario || await obtenerUsuarioDesdeCookies(req, res);
    if (!usuario) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ error: 'No autenticado' });
      }
      return res.redirect('/login');
    }
    req.usuario = usuario;
    if (!roles.includes(usuario.rol)) {
      return res.status(403).json({ error: 'No tenés permiso para esto' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole, obtenerUsuarioDesdeCookies };

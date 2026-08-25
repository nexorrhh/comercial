// Nombres y opciones de las cookies de sesión (tokens de Supabase Auth),
// compartidos entre el login (que las setea) y el middleware (que las lee y,
// si hace falta, las refresca).
const COOKIE_ACCESS = 'sb_access_token';
const COOKIE_REFRESH = 'sb_refresh_token';

const cookieOpts = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
  path: '/',
};

function setSessionCookies(res, session) {
  res.cookie(COOKIE_ACCESS, session.access_token, cookieOpts);
  res.cookie(COOKIE_REFRESH, session.refresh_token, cookieOpts);
}

function clearSessionCookies(res) {
  res.clearCookie(COOKIE_ACCESS, { path: '/' });
  res.clearCookie(COOKIE_REFRESH, { path: '/' });
}

module.exports = { COOKIE_ACCESS, COOKIE_REFRESH, cookieOpts, setSessionCookies, clearSessionCookies };

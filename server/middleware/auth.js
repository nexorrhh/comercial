function requireLogin(req, res, next) {
  if (!req.session || !req.session.usuario) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.usuario) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ error: 'No autenticado' });
      }
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.usuario.rol)) {
      return res.status(403).json({ error: 'No tenés permiso para esto' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };

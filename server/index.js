require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { requireLogin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const cotizacionesRoutes = require('./routes/cotizaciones');
const dashboardsRoutes = require('./routes/dashboards');
const usuariosRoutes = require('./routes/usuarios');
const catalogosRoutes = require('./routes/catalogos');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('trust proxy', 1); // por si va detrás de un reverse proxy (Caddy/nginx) en el servidor

app.use(session({
  store: new SQLiteStore({ dir: DATA_DIR, db: 'sesiones.db' }),
  secret: process.env.SESSION_SECRET || 'cambiar-este-secreto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
  },
}));

app.use(authRoutes);
app.use(requireLogin, cotizacionesRoutes);
app.use(requireLogin, dashboardsRoutes);
app.use(requireLogin, usuariosRoutes);
app.use(requireLogin, catalogosRoutes);

app.get('/', requireLogin, (req, res) => {
  res.render('index', { usuario: req.session.usuario });
});

// Actualización 6: solapa "Comercial" — vista reducida y filtrada del mismo
// listado, pensada para que el equipo comercial haga seguimiento sin tener que
// lidiar con todas las columnas y filtros de Listado.
app.get('/comercial', requireLogin, (req, res) => {
  res.render('comercial', { usuario: req.session.usuario });
});

// Actualización 8: solapa "Indicadores" — reporte libre de sólo lectura por
// Cliente y/o Comprador (totales de monto y toneladas, cotizado y adjudicado).
// Accesible a cualquier rol logueado, igual que Listado y Comercial.
app.get('/indicadores', requireLogin, (req, res) => {
  res.render('indicadores', { usuario: req.session.usuario });
});

app.get('/dashboards', requireLogin, (req, res) => {
  res.render('dashboards', { usuario: req.session.usuario });
});

app.get('/admin', requireLogin, (req, res) => {
  if (req.session.usuario.rol !== 'admin') return res.status(403).send('No autorizado');
  res.render('admin', { usuario: req.session.usuario });
});

app.listen(PORT, () => {
  console.log(`Sistema de cotizaciones escuchando en http://localhost:${PORT}`);
});

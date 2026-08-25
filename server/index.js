require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { requireLogin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const cotizacionesRoutes = require('./routes/cotizaciones');
const dashboardsRoutes = require('./routes/dashboards');
const usuariosRoutes = require('./routes/usuarios');
const catalogosRoutes = require('./routes/catalogos');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('trust proxy', 1); // Vercel / cualquier reverse proxy delante de la app

app.use(authRoutes);
app.use(requireLogin, cotizacionesRoutes);
app.use(requireLogin, dashboardsRoutes);
app.use(requireLogin, usuariosRoutes);
app.use(requireLogin, catalogosRoutes);

app.get('/', requireLogin, (req, res) => {
  res.render('index', { usuario: req.usuario });
});

// Solapa "Comercial" — vista reducida y filtrada del mismo listado, pensada
// para que el equipo comercial haga seguimiento sin tener que lidiar con
// todas las columnas y filtros de Listado.
app.get('/comercial', requireLogin, (req, res) => {
  res.render('comercial', { usuario: req.usuario });
});

// Solapa "Indicadores" — reporte libre de sólo lectura por Cliente y/o
// Comprador (totales de monto y toneladas, cotizado y adjudicado).
// Accesible a cualquier rol logueado, igual que Listado y Comercial.
app.get('/indicadores', requireLogin, (req, res) => {
  res.render('indicadores', { usuario: req.usuario });
});

app.get('/dashboards', requireLogin, (req, res) => {
  res.render('dashboards', { usuario: req.usuario });
});

app.get('/admin', requireLogin, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).send('No autorizado');
  res.render('admin', { usuario: req.usuario });
});

// module.exports para que Vercel pueda importar `app` como función serverless;
// app.listen sólo corre cuando el archivo se ejecuta directo (node server/index.js).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Sistema de cotizaciones escuchando en http://localhost:${PORT}`);
  });
}

module.exports = app;

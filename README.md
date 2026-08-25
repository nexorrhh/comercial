# Sistema de Cotizaciones e Indicadores ISO — Cimomet

Reemplaza al Excel "LISTADO DE INVITACIONES" como registro de cotizaciones, con:

- Un formulario web donde carga (rol admin), gerencia y comercial ven el mismo listado en vivo.
- Permisos por rol: quién puede crear, editar o borrar, y qué campos puede tocar cada uno.
- Historial de cambios: cada modificación queda registrada (quién, qué campo, valor anterior/nuevo, cuándo).
- Tableros que reemplazan a las hojas "GRAFICOS" e "INDICADOR ISO" del Excel, recalculados automáticamente, más un "Resumen por año".
- Una solapa "Comercial" con la vista de seguimiento del equipo comercial.
- Una solapa "Indicadores" con totales libres de monto y toneladas por Cliente/Comprador.

La base de datos y el login viven en **Supabase** (Postgres + Auth en la nube), así que el sistema se puede consultar desde cualquier lado sin depender de un servidor propio prendido.

## 1. Crear el proyecto de Supabase

1. Crear una cuenta/proyecto en [supabase.com](https://supabase.com).
2. Ir a **SQL Editor** y correr el contenido completo de [`server/lib/schema.sql`](server/lib/schema.sql). Es idempotente: correrlo de nuevo no duplica nada.
3. Ir a **Project Settings → API** y copiar: `Project URL` (→ `SUPABASE_URL`), `anon public key` (→ `SUPABASE_ANON_KEY`) y `service_role key` (→ `SUPABASE_SERVICE_ROLE_KEY`, **nunca** exponerla en el navegador).
4. Ir a **Project Settings → Database → Connection string**, elegir el modo **Transaction pooler (puerto 6543)** y copiarlo como `DATABASE_URL` (reemplazar `[YOUR-PASSWORD]` por la contraseña de la base).
5. En **Authentication → Providers**, confirmar que Email esté habilitado (es lo que se usa para loguearse).

## 2. Variables de entorno

Copiar `.env.example` a `.env` y completar los 4 valores de Supabase de arriba.

## 3. Primer arranque (local)

Requiere [Node.js](https://nodejs.org) 22+ (los scripts de `migration/` usan el módulo `node:sqlite` incluido desde esa versión).

**Opción rápida (Windows):** doble clic en [`iniciar.bat`](iniciar.bat) — instala dependencias la primera vez, abre el `.env` para completarlo si hace falta, y levanta el sistema en `http://localhost:3000`.

**A mano:**
```
npm install
npm start
```

## 4. Crear el primer usuario administrador

La pantalla de administración (`/admin`) requiere estar logueado como admin, así que el primero se crea por línea de comandos:

```
npm run create-admin -- tu-email@empresa.com "UNA-CONTRASEÑA-SEGURA" "Nombre y Apellido" admin
```

Desde ahí, ese admin puede dar de alta al resto del equipo desde `/admin`.

## 5. Si ya tenías datos cargados en la versión anterior (SQLite)

Si este sistema ya venía corriendo con la base SQLite local (`data/cotizaciones.db`), hay un script que migra todo (usuarios, catálogos, cotizaciones, historial) a Supabase de una sola vez:

```
node migration/migrate_to_supabase.js --dominio=tuempresa.com
```

- Cada usuario viejo se recrea en Supabase Auth con una contraseña provisoria; el detalle (incluidas las contraseñas) queda en `data/reporte_migracion_supabase.json` — avisarle a cada persona la suya (o cambiarla desde `/admin`) y después borrar ese archivo.
- `--dominio` se usa sólo para los usuarios cuyo "usuario" de login no era ya un email (les arma uno del tipo `usuario@tuempresa.com`); si no se pasa, usa un dominio de relleno que no hace falta que resuelva.
- Se puede correr contra una **copia** de `data/cotizaciones.db` primero para probar sin arriesgar la base real.

Si en cambio es una instalación totalmente nueva (sin datos previos), este paso no aplica — arrancar directo desde el paso 4.

## 6. Roles y usuarios

| Rol | Puede ver | Puede editar |
|---|---|---|
| admin | Todo | Todo, incluyendo borrar y crear, y los campos de montos/moneda/tipo de cotización |
| gerencia | Todo | Estado, adjudicado, oferta, OT, toneladas, categoría, fecha de presentación, cotiza por, montos, moneda, tipo de cotización, hora de cierre, observaciones, responsable comercial — no borra ni crea |
| comercial | Todo | Sólo estado, adjudicado, observaciones y % mayor costo, y sólo en las cotizaciones que tenga asignadas |
| lectura | Todo | Nada |

## 7. Subir a GitHub

```
git remote add origin https://github.com/TU-ORGANIZACION/TU-REPO.git
git push -u origin master
```

## 8. Desplegar en Vercel + dominio propio

1. En [vercel.com](https://vercel.com), importar el repo de GitHub (usa [`vercel.json`](vercel.json), ya incluido).
2. En **Settings → Environment Variables** del proyecto en Vercel, cargar las mismas 4 variables de Supabase del paso 2 (más `COOKIE_SECURE=true`, ya que en Vercel siempre se sirve por HTTPS).
3. Deploy. Cada push a la rama principal vuelve a desplegar solo.
4. Para el dominio propio: **Settings → Domains** en Vercel, agregar el subdominio (ej. `cotizaciones.tuempresa.com`) y crear el registro DNS que Vercel indique (CNAME, normalmente) en el proveedor de dominio de la empresa.

## 9. Backups

Supabase hace backups automáticos de la base (la retención exacta depende del plan contratado) — revisar **Project Settings → Backups** en el dashboard.

## 10. Estructura del proyecto

```
server/            Backend (Node.js + Express, Postgres vía Supabase)
  lib/schema.sql    Modelo de datos completo (correr en el SQL Editor de Supabase)
  lib/db.js         Pool de conexión a Postgres
  lib/supabaseAdmin.js / supabaseAuth.js   Clientes de Supabase (service role / anon)
  routes/           Endpoints de la API (cotizaciones, dashboards, usuarios, catálogos, auth)
views/              Páginas (EJS): login, listado, comercial, indicadores, tableros, administración
public/             CSS/JS del frontend y Chart.js empaquetado localmente
migration/          create_user.js (alta admin), migrate_to_supabase.js (SQLite -> Supabase),
                    import_excel.js / inferir_modo_envio.js / legacySqliteDb.js (históricos, sistema previo)
vercel.json         Configuración de despliegue en Vercel
iniciar.bat         Arranque local con doble clic (Windows)
```

# Seguimiento de Cotizaciones — Cimomet

Sistema de seguimiento de cotizaciones e indicadores ISO. Node.js + Express +
EJS, con Supabase (Postgres + Auth) como base de datos y login.

## Reglas de trabajo (leer antes de tocar nada)

### 1. Nunca hacer `git push` ni deployar sin permiso explícito

Este repo está conectado a Vercel: **cualquier push a `master` en GitHub
redespliega automáticamente el link de producción** (`comercial-cimomet.vercel.app`
o el dominio que se le ponga después), que usa gente real con datos reales.

- Todo el trabajo de desarrollo, prueba y ajuste se hace **en local** —
  commitear localmente está bien, pero **nunca correr `git push`**, `gh` para
  crear PRs que se mergeen solos, ni ninguna acción que impacte el remoto,
  salvo que el dueño del proyecto lo pida explícitamente en esa conversación.
- Cuando una tanda de cambios esté lista y probada localmente, avisar
  claramente qué se hizo y qué falta probar, y esperar a que el dueño decida
  cuándo y qué se sube. El dueño es quien hace el `git push` final (o pide
  puntualmente que se haga).
- Esto aplica aunque el cambio parezca chico o "seguro".

### 2. Este proyecto de Supabase es compartido con otros sistemas

La base de Supabase que usa esta app (`DATABASE_URL` / `SUPABASE_URL` en
`.env`) **no es exclusiva de este proyecto** — conviven ahí tablas de otros
sistemas de la empresa.

- Esta app únicamente puede crear, leer, modificar o borrar tablas cuyo
  nombre empiece con **`comercial_`** (`comercial_perfiles`,
  `comercial_cotizaciones`, `comercial_catalogo_*`, `comercial_historial_cambios`,
  `comercial_log_accesos`, y cualquier tabla nueva que se agregue para este
  sistema — también con ese prefijo).
- Nunca leer, escribir, ni referenciar por nombre ninguna tabla sin ese
  prefijo, aunque aparezca al listar el esquema. Si hace falta un dato que
  parece vivir en otra tabla, preguntar antes de asumir o de tocarla.
- No hay entorno de pruebas separado: el desarrollo local pega contra esta
  misma base (ver más abajo), así que los datos de prueba que se generen
  dentro de `comercial_cotizaciones` etc. son datos reales de la empresa —
  evitar borrar filas reales al probar, y avisar si se crean registros de
  prueba que después haya que limpiar.

### 3. Cómo probar en local

`iniciar.bat` (doble clic, o `npm start` desde la terminal) levanta el
servidor Express en `http://localhost:3000`, usando las credenciales de
Supabase que ya están cargadas en `.env`. Como el `.env` apunta a la base
real (ver punto 2), lo que se ve y modifica en local es el sistema de verdad,
no una copia.

## Estructura del proyecto

```
server/            Backend (Node.js + Express, Postgres vía Supabase)
  lib/schema.sql    Modelo de datos completo (tablas comercial_*)
  lib/db.js         Pool de conexión a Postgres
  lib/supabaseAdmin.js / supabaseAuth.js   Clientes de Supabase (service role / anon)
  middleware/auth.js  Valida la sesión (cookies) contra Supabase Auth
  routes/           Endpoints de la API (cotizaciones, dashboards, usuarios, catálogos, auth)
views/              Páginas (EJS): login, listado, comercial, indicadores, tableros, administración
public/             CSS/JS del frontend y Chart.js empaquetado localmente
migration/          Scripts puntuales: create_user.js (alta admin), migrate_to_supabase.js
                    (SQLite vieja -> Supabase), import_excel.js / inferir_modo_envio.js /
                    legacySqliteDb.js (históricos, sistema previo a Supabase)
vercel.json         Configuración de despliegue en Vercel
iniciar.bat         Arranque local (Windows)
```

Ver `README.md` para la guía completa de setup (Supabase, variables de
entorno, deploy).

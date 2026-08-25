# Sistema de Cotizaciones e Indicadores ISO — Cimomet

Reemplaza al Excel "LISTADO DE INVITACIONES" como registro de cotizaciones, con:

- Un formulario web donde carga (rol admin), gerencia y comercial ven el mismo listado en vivo.
- Permisos por rol: quién puede crear, editar o borrar, y qué campos puede tocar cada uno.
- Historial de cambios: cada modificación queda registrada (quién, qué campo, valor anterior/nuevo, cuándo).
- Tableros que reemplazan a las hojas "GRAFICOS" e "INDICADOR ISO" del Excel, recalculados automáticamente, más un "Resumen por año" (Actualización 8).
- Una solapa "Comercial" (Actualización 6) con la vista de seguimiento del equipo comercial.
- Una solapa "Indicadores" (Actualización 8) con totales libres de monto y toneladas por Cliente/Comprador.

## 1. Requisitos en el servidor

Docker y Docker Compose instalados (Docker Desktop en Windows, o docker.io/docker-ce + docker-compose-plugin en Linux).

## 2. Primer arranque

1. Copiar toda esta carpeta al servidor.
2. Copiar `.env.example` a `.env` y completar `SESSION_SECRET`.
3. `docker compose up -d --build`
4. Crear el usuario administrador inicial:
   `docker compose exec app node migration/create_user.js admin "UNA-CONTRASEÑA-SEGURA" "Nombre y Apellido" admin`
5. Entrar desde un navegador a `http://IP-DEL-SERVIDOR:3000`.

## 3. Importar los datos del Excel actual

```
docker compose cp "LISTADO DE INVITACIONES.xlsx" app:/tmp/listado.xlsx
docker compose exec app node migration/import_excel.js /tmp/listado.xlsx admin
```

Correr la importación dos veces sobre el mismo Excel duplica las cotizaciones — coordinar antes de reimportar.

## 4. Roles y usuarios

| Rol | Puede ver | Puede editar |
|---|---|---|
| admin | Todo | Todo, incluyendo borrar y crear, y los campos de montos/moneda/tipo de cotización |
| gerencia | Todo | Estado, adjudicado, oferta, OT, toneladas, categoría, fecha de presentación, cotiza por, montos, moneda, tipo de cotización, hora de cierre, observaciones, responsable comercial — no borra ni crea |
| comercial | Todo | Sólo estado, adjudicado y observaciones, y sólo en las cotizaciones que tenga asignadas |
| lectura | Todo | Nada |

## 5. Acceso remoto (celular / casa)

**Opción A — dominio propio + reverse proxy (Caddy, incluido):** subdominio propio + puertos 80/443 redirigidos + `CADDY_DOMINIO` en `.env` + descomentar servicio `caddy` + `COOKIE_SECURE=true` recién cuando ya esté detrás de HTTPS.

**Opción B — Cloudflare Tunnel / Tailscale:** sin abrir puertos del router, más simple para una PyME sin IT dedicado.

## 6. Backups

Copiar `data/cotizaciones.db` a otro disco/servidor todas las noches, y antes de cualquier actualización.

## 7. Actualizaciones futuras

```
docker compose up -d --build
```

La base de datos (`data/`) no se toca en una actualización de este tipo. Las columnas nuevas que agregue una actualización se crean solas al prender el sistema (auto-migración en `server/lib/db.js`), sin perder ninguna fila existente.

## 8. Estructura del proyecto

```
server/            Backend (Node.js + Express + SQLite)
  lib/schema.sql    Modelo de datos completo
  routes/           Endpoints de la API (cotizaciones, dashboards, usuarios, catálogos)
views/              Páginas (EJS): login, listado, comercial, indicadores, tableros, administración
public/             CSS/JS del frontend y Chart.js empaquetado localmente
migration/          Scripts de importación del Excel, creación de usuarios y backfill de modo de entrega
data/               Base de datos SQLite (persiste vía volumen de Docker)
```

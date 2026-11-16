# Configuración manual: proveedores externos, keys y secretos

Este documento reúne todo lo que hay que hacer a mano (cuentas, dashboards, keys) para que el programa funcione completo. El código ya está listo y está en `main`. Cada paso indica dónde vive el valor y si es secreto.

Regla general: los secretos viven solo en el proyecto Vercel del backend. El proyecto del frontend no necesita variables de entorno: el destino del backend está fijo en `frontend/vercel.json`. Los IDs públicos de GA4, Clarity y Sentry van escritos en el código del frontend, porque están pensados para el navegador.

## Qué funciona sin nada configurado

Sin ninguna key, `/api/sample` responde las búsquedas de producto desde el índice estático. Sin Redis no hay caché ni rate limit. Sin Postgres no se registra nada. Sin IDs de tracking no se carga ningún rastreador. Es decir, cada pieza falla abierta, y se pueden configurar de a una.

## Orden recomendado

1. Herramientas locales
2. Cuentas de datos: Upstash Redis y Neon Postgres (hecho, falta aplicar el esquema)
3. Keys de IA: NVIDIA y Gemini
4. Proyecto Vercel del backend (Tarea 4 del plan del split)
5. Protection Bypass (ya no se usa, ver nota)
6. Proyecto Vercel del frontend y verificación en Preview (Tarea 6)
7. Cuentas de tracking: GA4, Clarity, Sentry, y cambio de IDs en el código
8. BigQuery y Looker Studio
9. Revisión legal del banner
10. Cutover de producción (Tarea 7)

---

## 1. Herramientas locales

- Vercel CLI: `npm i -g vercel`, luego `vercel login`.
- Una vez: `cd backend && npm install`.

## 2. Cuentas de datos (hecho: Neon y Upstash instalados desde el Marketplace de Vercel)

Ambas integraciones están conectadas al proyecto `asistente-calle80-backend` en Production y Preview, sin Development. Quedó así:

### Neon Postgres (log de búsquedas y encuesta)

- Región Washington, D.C. (East), la misma zona que las funciones de Vercel (`iad1`). Auth y Realtime desactivados: la app no tiene usuarios ni escucha cambios.
- Al conectar el proyecto: "Create database branch for deployment" marcado solo en **Preview** (cada preview recibe una copia aislada de la rama principal), **Production sin marcar** (producción usa la rama principal, para que los datos no se dispersen en ramas). Custom Prefix vacío, para que las variables se llamen `POSTGRES_URL` y `DATABASE_URL`. Sensitive activo.
- Pendiente: aplicar el esquema en la **rama principal** desde el SQL Editor de Neon, ejecutando `backend/sql/001_busquedas.sql`. Hacerlo antes del primer Preview, porque cada Preview copia la rama principal.
- Secreto: sí. Solo backend.

### Upstash Redis (caché y rate limit)

- Producto Upstash for Redis, plan gratuito, región `us-east-1`, eviction activada, Custom Prefix vacío.
- Debe inyectar `KV_REST_API_URL` y `KV_REST_API_TOKEN` (el código también acepta `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`). Si en Settings → Environment Variables solo aparecen `REDIS_URL` y `KV_URL`, el código no los usa: lee la API REST, no `redis://`.
- Secreto: sí (el token). Solo backend.

### Verificación

En Settings → Environment Variables del backend deben existir `POSTGRES_URL`, `KV_REST_API_URL` y `KV_REST_API_TOKEN` en Production y Preview.

### Migración de datos

No hay. La base de Neon nace vacía (el log y la encuesta son funciones nuevas) y solo se le aplica el esquema. Redis guarda caché de 6 h y contadores de 10 min, y se llena solo.

### Uso en local

No hace falta. Sin variables, el backend funciona en local con todo fail-open (fast path, sin caché ni log), y `npm test` simula Redis y Postgres. Con Development desactivado y las variables en modo Sensitive, `vercel env pull` no las trae. Si algún día se quiere probar en local contra datos reales, crear una rama de Neon y una base de Upstash aparte, nunca las de producción.

## 3. Keys de IA

- NVIDIA: generar la key en https://build.nvidia.com → `NVIDIA_API_KEY`. Se aceptan varias separadas por coma, más sufijos `_2` a `_9`.
- Gemini: generar la key en https://aistudio.google.com → `GEMINI_API_KEY`. Mismo esquema de varias keys.
- Opcionales: `NVIDIA_MODEL`, `GEMINI_MODEL`.
- Secreto: sí. Solo backend.
- Si cambió el catálogo, regenerar vectores antes de desplegar: `NVIDIA_API_KEY=... node scripts/build_vectores.js`.

## 4. Proyecto Vercel del backend (Tarea 4)

1. Hecho: proyecto `asistente-calle80-backend` creado con Root Directory `backend/`. Dominio: `https://asistente-calle80-backend.vercel.app`. Framework Preset "Other", sin Build Command. Ver la nota sobre la rama a desplegar al final de este paso.
2. Cargar las variables en Production y Preview:

| Variable | Origen | Secreto |
|---|---|---|
| `NVIDIA_API_KEY` | paso 3 | sí |
| `GEMINI_API_KEY` | paso 3 | sí |
| `NVIDIA_MODEL`, `GEMINI_MODEL` | opcionales | no |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Marketplace (ya inyectadas) | token sí |
| `POSTGRES_URL` | Marketplace (ya inyectada) | sí |

3. Desplegar y comprobar que el deploy no está roto. Si Deployment Protection responde con un 401 o un reto, es lo esperado hasta el paso 5.
4. Rama desplegada: `main`, que ya contiene el split. Backend verificado con `curl` el 2026-11-15, incluida la escritura en Postgres.

## 5. Protection Bypass (no se usa hoy)

Se probó un diseño con `BACKEND_URL` y `BACKEND_BYPASS_SECRET` en el frontend y un header inyectado desde `vercel.json`. No funcionó: `rewrites` no admite `transforms` de headers, y `routes` con `transforms` y `${BACKEND_URL}` devolvió 404 en el deploy real. Hoy el frontend usa `rewrites` con el destino fijo, sin variables, y el alias de producción del backend no tiene Deployment Protection, así que no hace falta el bypass.

Las variables `BACKEND_URL` y `BACKEND_BYPASS_SECRET` que ya existen en el proyecto frontend no se usan y se pueden borrar. Si un día se protege el backend o se prueba contra un Preview protegido, el bypass se puede pasar como parámetro en el destino (`?x-vercel-protection-bypass=<secreto>`), sabiendo que el secreto queda visible en los logs de URL.

Auditoría: en el frontend no debe haber `NVIDIA_API_KEY`, `GEMINI_API_KEY`, variables de Redis ni `POSTGRES_URL`.

## 6. Proyecto Vercel del frontend y verificación (Tarea 6)

1. Hecho: proyecto `asistente-calle80-frontend` con Root Directory `frontend/`, Framework Preset "Other", Output Directory `public`. Dominio: `https://asistente-calle80-frontend.vercel.app`. No requiere variables de entorno.
2. Verificar con los `curl` y el navegador descritos en la Tarea 6 del plan `2026-11-15-split-frontend-backend-trusted-sources.md`. El resultado esperado es un 200 con JSON real, no HTML de reto.
3. Verificado el 2026-11-15 con `curl` contra el frontend: `/api/sample` (ruta rápida y camino de IA), `/api/encuesta`, 405 y 400, caché de Redis (`"cache":true`), y headers de seguridad en las respuestas de `/api`. Falta la prueba del cliente en el navegador.
4. Equipo Hobby: Vercel solo despliega commits cuyo autor sea el dueño del equipo. Antes de commitear, configurar `git config user.email` con el email verificado de la cuenta de GitHub vinculada a Vercel. De lo contrario el deploy falla con `TEAM_ACCESS_REQUIRED`, también si se despliega con la CLI.

## 7. Cuentas de tracking

Estos tres IDs son públicos y se escriben en `frontend/public/index.html`, líneas 547-549, como constantes dentro de `initTracking()`:

| Constante | Dónde sacarlo | Formato |
|---|---|---|
| `GA4_ID` | https://analytics.google.com → crear propiedad → Flujo de datos web → ID de medición | `G-XXXXXXXXXX` |
| `CLARITY_ID` | https://clarity.microsoft.com → nuevo proyecto → ID del proyecto | cadena de 10 caracteres |
| `SENTRY_DSN` | Sentry → proyecto tipo Browser JavaScript → Client Keys (DSN) | `https://<key>@o<org>.ingest.<región>.sentry.io/<proyecto>` |

Mientras un ID siga como placeholder, `initTracking()` no carga ese proveedor. Después de reemplazarlos hay que redesplegar el frontend.

CSP: `frontend/vercel.json` ya permite `*.ingest.sentry.io` y `*.ingest.us.sentry.io`. Si el DSN real usa otro host (por ejemplo `ingest.de.sentry.io` o un dominio propio), hay que agregarlo a `connect-src`. Con Clarity y GA4, confirmar en la consola del navegador que no aparecen violaciones de CSP.

### Dónde alojar Sentry

Recomendación: no alojarlo uno mismo. Usar Sentry SaaS (sentry.io) con su plan gratuito, que alcanza de sobra para un beta de cientos o miles de sesiones al día. No hay servidor que operar, y el DSN ya encaja con el CSP que existe.

Si aun así se quiere un Sentry propio, según el repositorio oficial `getsentry/self-hosted` el instalador exige como mínimo 4 núcleos y 14 GB de RAM (perfil completo), o 2 núcleos y 7 GB con el perfil `errors-only`. Corre con Docker Compose. Eso significa una VPS dedicada, por ejemplo en Hetzner, DigitalOcean u otra, de unos 16 GB de RAM para el perfil completo. Vercel no sirve para esto, porque Sentry necesita contenedores persistentes. Además habría que:

- Poner un dominio propio con HTTPS delante (reverse proxy) y configurar `system.url-prefix`, `SECURE_PROXY_SSL_HEADER` y `CSRF_TRUSTED_ORIGINS`.
- Cambiar el `SENTRY_DSN` para que apunte a ese dominio y agregarlo a `connect-src` en `frontend/vercel.json`.
- Encargarse de backups, actualizaciones y de la seguridad del servidor.

El proyecto no necesita ese costo ni esa carga operativa hoy.

## 8. BigQuery y Looker Studio

1. GA4 → Administrar → Vinculación de BigQuery → crear el vínculo (nivel gratuito/sandbox) con un proyecto de Google Cloud.
2. En https://lookerstudio.google.com crear el informe con dos fuentes: Postgres (tabla `busquedas`, conexión de solo lectura a Neon) y el export de GA4 en BigQuery.
3. Crear en Neon un usuario de solo lectura para Looker. No reutilizar `POSTGRES_URL`.

## 9. Revisión legal del banner

Enviar el texto del banner (`frontend/public/index.html`, barra `consentBar`) al negocio o a un abogado para revisión bajo la Ley 1581. No abrir el beta a tráfico real con tracking activo sin esa revisión. Si cambia el texto, actualizarlo en el HTML.

## 10. Cutover de producción (Tarea 7)

1. Reasignar el dominio real del proyecto Vercel único al proyecto `calle80-frontend`.
2. Repetir en producción las verificaciones de la Tarea 6.
3. Dejar vivo el proyecto Vercel único anterior mientras dure la ventana de rollback. Reasignar el dominio de vuelta es el rollback.
4. Registrar el resultado en `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`.

---

## Lista final de variables

Backend (solo ahí):

- `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_MODEL` (opcional), `GEMINI_MODEL` (opcional)
- `KV_REST_API_URL` y `KV_REST_API_TOKEN`, o `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`
- `POSTGRES_URL` (o `DATABASE_URL`)

Frontend: ninguna.

En el código del frontend, públicos: `GA4_ID`, `CLARITY_ID`, `SENTRY_DSN`.

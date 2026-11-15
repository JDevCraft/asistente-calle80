# Configuración manual: proveedores externos, keys y secretos

Este documento reúne todo lo que hay que hacer a mano (cuentas, dashboards, keys) para que el programa funcione completo. El código ya está listo y está en `main`. Cada paso indica dónde vive el valor y si es secreto.

Regla general: los secretos viven solo en el proyecto Vercel del backend. El proyecto del frontend recibe únicamente `BACKEND_URL` y `BACKEND_BYPASS_SECRET`. Los IDs públicos de GA4, Clarity y Sentry van escritos en el código del frontend, porque están pensados para el navegador.

## Qué funciona sin nada configurado

Sin ninguna key, `/api/sample` responde las búsquedas de producto desde el índice estático. Sin Redis no hay caché ni rate limit. Sin Postgres no se registra nada. Sin IDs de tracking no se carga ningún rastreador. Es decir, cada pieza falla abierta, y se pueden configurar de a una.

## Orden recomendado

1. Herramientas locales
2. Cuentas de datos: Upstash Redis y Neon Postgres
3. Keys de IA: NVIDIA y Gemini
4. Proyecto Vercel del backend (Tarea 4 del plan del split)
5. Protection Bypass y variables del frontend (Tarea 5)
6. Proyecto Vercel del frontend y verificación en Preview (Tarea 6)
7. Cuentas de tracking: GA4, Clarity, Sentry, y cambio de IDs en el código
8. BigQuery y Looker Studio
9. Revisión legal del banner
10. Cutover de producción (Tarea 7)

---

## 1. Herramientas locales

- Vercel CLI: `npm i -g vercel`, luego `vercel login`.
- Una vez: `cd backend && npm install`.

## 2. Cuentas de datos

### Upstash Redis (caché y rate limit)

- Se crea desde el Marketplace de Vercel (integración Upstash for Redis) o directo en https://upstash.com.
- Con la integración de Vercel se inyectan `KV_REST_API_URL` y `KV_REST_API_TOKEN`. Con cuenta directa se usan `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`. El código acepta ambos pares.
- Secreto: sí (el token). Va solo al backend.

### Neon Postgres (log de búsquedas y encuesta)

- Crear proyecto en https://neon.tech (o desde el Marketplace de Vercel).
- Aplicar el esquema una vez: abrir el SQL Editor de Neon y ejecutar el contenido de `backend/sql/001_busquedas.sql`.
- Copiar la cadena de conexión a `POSTGRES_URL` (o `DATABASE_URL` como alternativa).
- Secreto: sí. Va solo al backend, nunca al frontend.

## 3. Keys de IA

- NVIDIA: generar la key en https://build.nvidia.com → `NVIDIA_API_KEY`. Se aceptan varias separadas por coma, más sufijos `_2` a `_9`.
- Gemini: generar la key en https://aistudio.google.com → `GEMINI_API_KEY`. Mismo esquema de varias keys.
- Opcionales: `NVIDIA_MODEL`, `GEMINI_MODEL`.
- Secreto: sí. Solo backend.
- Si cambió el catálogo, regenerar vectores antes de desplegar: `NVIDIA_API_KEY=... node scripts/build_vectores.js`.

## 4. Proyecto Vercel del backend (Tarea 4)

1. Dashboard de Vercel → Add New Project → importar este repo → Root Directory `backend/` → nombre `calle80-backend`.
2. Cargar las variables en Production y Preview:

| Variable | Origen | Secreto |
|---|---|---|
| `NVIDIA_API_KEY` | paso 3 | sí |
| `GEMINI_API_KEY` | paso 3 | sí |
| `NVIDIA_MODEL`, `GEMINI_MODEL` | opcionales | no |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (o `UPSTASH_*`) | paso 2 | token sí |
| `POSTGRES_URL` | paso 2 | sí |

3. Desplegar y comprobar que el deploy no está roto. Si Deployment Protection responde con un 401 o un reto, es lo esperado hasta el paso 5.

## 5. Protection Bypass y variables del frontend (Tarea 5)

1. En el proyecto backend: Settings → Deployment Protection → Protection Bypass for Automation → generar el secreto. Vercel lo expone en el backend como `VERCEL_AUTOMATION_BYPASS_SECRET`.
2. En el proyecto frontend, crear `BACKEND_BYPASS_SECRET` con ese mismo valor (Production y Preview). El nombre es distinto a propósito, para no chocar con la variable que Vercel pone en el frontend.
3. Crear `BACKEND_URL` en el frontend:
   - Production: dominio de producción del backend.
   - Preview: `https://calle80-backend-git-<rama>.vercel.app` (alias fijo por rama).
4. Auditoría: en el frontend no debe haber `NVIDIA_API_KEY`, `GEMINI_API_KEY`, variables de Redis ni `POSTGRES_URL`.

## 6. Proyecto Vercel del frontend y verificación (Tarea 6)

1. Add New Project → mismo repo → Root Directory `frontend/` → nombre `calle80-frontend`. Las variables del paso 5 deben existir antes del primer deploy.
2. Verificar con los `curl` y el navegador descritos en la Tarea 6 del plan `2026-11-15-split-frontend-backend-trusted-sources.md`. El resultado esperado es un 200 con JSON real, no HTML de reto.
3. No hacer `git push origin main` ni cutover hasta que este paso pase. Si el proyecto Vercel único actual sigue conectado a `main`, un push prematuro rompe producción, porque ya no existe `vercel.json` en la raíz.

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

Frontend (solo estas dos):

- `BACKEND_URL`
- `BACKEND_BYPASS_SECRET`

En el código del frontend, públicos: `GA4_ID`, `CLARITY_ID`, `SENTRY_DSN`.

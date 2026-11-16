/c# Log de ejecución: separar frontend/backend, tracking de beta, prueba de carga

Diseño de referencia:
`2026-11-15-split-tracking-loadtest-design.md`. Este archivo es memoria de
avance entre sesiones, no un plan — el plan paso a paso vive donde lo deje
`superpowers:writing-plans`.

Actualizar cada frente al terminarlo: fecha, qué se hizo, qué quedó
pendiente o decidido distinto a lo escrito en el diseño.

### 2026-11-15 — Split frontend/backend: código mergeado a `main`, falta configurar Vercel

Tareas 1-3 de `docs/superpowers/plans/2026-11-15-split-frontend-backend-trusted-sources.md`
hechas, revisadas (task reviews + revisión final de rama, 0 Critical, 2
Important corregidos en una ronda de fix, 3 Minor parcheados o aparcados
con ruling) y mergeadas (fast-forward) a `main` localmente. `main` ya tiene
`backend/` y `frontend/` con sus `vercel.json`, el `vercel.json` raíz
desapareció, `npm test` sigue en 25/25.

**`main` NO está pusheado a `origin` todavía.** Mientras no se pushee, no
hay riesgo de que el proyecto Vercel único actual (si sigue conectado a la
rama remota) dispare un auto-deploy roto. **No hacer `git push origin
main` ni desplegar `main` hasta completar las Tareas 4-6** del plan (alta
de los dos proyectos Vercel, Protection Bypass for Automation configurado,
rewrite verificado en Preview) — después de eso, el root `vercel.json` ya
no existe para que el proyecto único construya, así que un push antes de
tiempo rompe producción en el siguiente auto-deploy.

Pendiente: Tareas 4-7 (alta de los 2 proyectos Vercel, Protection Bypass,
verificación extremo a extremo, cutover de producción) — son pasos
manuales de dashboard/CLI de Vercel, fuera del alcance de lo que esta
sesión pudo ejecutar.

## Frentes

- [x] Separar frontend/backend en dos proyectos Vercel + rewrite — desplegado y verificado con `curl` (2026-11-15); falta solo el cutover del dominio real. Código
      mergeado a `main` (Tareas 1-3); faltan Tareas 4-7 (alta de proyectos
      Vercel + Protection Bypass + cutover), ver entrada 2026-11-15 arriba.
- [x] Rate limiting compartido — implementado en Redis (`api/_estado.js`), no
      en `@vercel/firewall`: ver desviación 2026-11-15 abajo.
- [x] Caché compartido (Upstash Redis, Marketplace)
- [-] Trusted Sources / Protection Bypass entre los dos proyectos — no se usa: ver entrada 2026-11-15 de Vercel
- [x] Log estructurado de búsquedas en Postgres (texto, destino, proveedor,
      canal voz/texto, tiempo de respuesta) — Neon creado, esquema aplicado y
      fila de prueba verificada (2026-11-15)
- [x] Microsoft Clarity — ID real puesto (`zea1biij2f`); falta confirmar la
      sesión en la consola de Clarity y poner el masking en Strict
- [x] Google Analytics 4 (+ Core Web Vitals vía `web-vitals`) — ID real puesto
      (`G-0YE9GH8L7X`); falta confirmar la visita en Tiempo real
- [x] Captura de errores de cliente (Sentry SaaS) — proyecto
      `juan-moreno-4e/calle80-frontend`, DSN puesto, un error de prueba llegó
      (`CALLE80-FRONTEND-1`); host `ingest.us.sentry.io` ya está en la CSP
- [ ] **Sentry: la prueba de Business vence el 2026-11-28.** Revisar
      Settings → Subscription ese día; si no pasa solo a Developer (gratis),
      bajar el plan o cancelar antes de que venza. No agregar tarjeta durante
      la prueba. Team (29 USD/mes) no es necesario. Sin plan, el sitio no se
      rompe: solo se dejan de recibir errores.
- [x] Banner de tratamiento de datos (aviso + opción de rechazar)
- [x] Micro-encuesta "¿te ayudó?" (respuesta → Postgres)
- [ ] Export de GA4 a BigQuery
- [ ] Panel en Looker Studio (Postgres + BigQuery)
- [-] Prueba de carga (k6/Artillery) contra preview — descartada por el usuario el 2026-11-15
- [ ] Revisión legal del texto del banner (negocio/abogado, fuera de este
      trabajo técnico)

## Entradas

### 2026-11-15 — IDs de tracking puestos y Sentry verificado

Puestos en `frontend/public/index.html:547-549`: `GA4_ID`, `CLARITY_ID` y `SENTRY_DSN`. Sentry se configuró con el CLI (v0.49.0, organización `juan-moreno-4e`), proyecto `calle80-frontend` (plataforma javascript). Se mantuvo el esquema existente (bundle del CDN con SRI y `Sentry.init({ dsn })`); no se instaló el SDK por npm porque no hay bundler. El aviso "instalar el SDK" del dashboard de Sentry desaparece solo con el primer evento; un error de prueba lanzado desde la consola en incógnito llegó y se ve con `sentry issue list`.

El mensaje de consola `Connecting to '.../bundle.min.js.map' violates ... connect-src` es el source map del SDK que pide DevTools; no afecta a usuarios. Se decidió no ampliar la CSP por eso. El `Unchecked runtime.lastError` de la consola viene de una extensión del navegador, no del código.

Equipo Hobby: el autor de los commits debe ser el dueño del equipo; los commits se re-firman antes del push.

Pendiente: confirmar GA4 (Tiempo real) y Clarity (sesión); en Clarity, masking en Strict; en Sentry, Allowed Domains en Client Keys y un límite de eventos por minuto; el vencimiento de la prueba el 2026-11-28 (arriba); revisión legal del banner; cutover del dominio real; borrar la fila de prueba de `busquedas` (`id = 'e45ea84a-3ff3-47d4-bd0b-d83badb3c22a'`); borrar las variables sin uso `BACKEND_URL` y `BACKEND_BYPASS_SECRET` del proyecto frontend; borrar las ramas locales `backup/*`; BigQuery y Looker Studio.

### 2026-11-15 — Backend y frontend desplegados en Vercel

Creados `asistente-calle80-backend` (Root Directory `backend/`) y `asistente-calle80-frontend` (Root Directory `frontend/`) en el equipo Hobby `jdevcrafts-projects`, desplegando `main` por Git. Neon (Washington D.C., Auth y Realtime apagados, rama por Preview, Production sin rama) y Upstash (us-east-1) instalados desde el Marketplace y conectados solo al backend. El esquema `backend/sql/001_busquedas.sql` está aplicado y una búsqueda real escribió su fila en `busquedas`.

Verificado con `curl` contra el frontend: `/api/sample` por ruta rápida y por el modelo de IA, `/api/encuesta`, 405 y 400, caché de Redis (`"cache":true`), y headers de seguridad también en `/api`. `npm test`: 49/49.

Desviaciones del plan del split, todas por ruling:
- El diseño con `rewrites` + `transforms` de headers es inválido: el esquema de Vercel solo admite `request.path` en `transforms` de `rewrites`.
- `routes` con `transforms` y `${BACKEND_URL}` en `dest` validaba contra el esquema pero devolvió 404 en el deploy. Lo que funciona es `headers` + `rewrites` con el destino del backend fijo en `frontend/vercel.json`. Por eso `BACKEND_URL` y `BACKEND_BYPASS_SECRET` ya no se usan (siguen creadas en el proyecto frontend y se pueden borrar), y no se envía bypass: el alias de producción del backend no tiene Deployment Protection.
- Equipo Hobby: Vercel solo despliega commits del dueño del equipo; hay que configurar `git config user.email` con su email verificado antes de commitear, también para `vercel --prod` desde la CLI.

Pendiente: probar el cliente en el navegador (búsqueda por texto y por voz, mapa, consola sin violaciones de CSP); IDs reales de GA4, Clarity y Sentry en `frontend/public/index.html`; revisión legal del banner; cutover del dominio real con el proyecto estable como rollback; BigQuery y Looker Studio; después del beta, refactor del frontend (mover la selección de SKUs al backend y quitar `'unsafe-inline'` de la CSP).

### 2026-11-15 — Tracking de beta: código en `feat/tracking-beta`

Tareas 1-8 del plan de tracking hechas y commiteadas en `feat/tracking-beta`
(`c05b295..HEAD`: 05103d1, d54f01d, d91d7f1, 86365f8, 8ec5da0, cf93885,
e921f32, 86c42a0, e618c36, f76ff39; la Tarea 9 son estos docs). Suite 49/49.
**La rama no está mergeada ni pusheada.**

Qué quedó: CSP con allowlist (GA4, Clarity, Sentry, web-vitals) en
`frontend/vercel.json`; banner opt-out no bloqueante y `initTracking()`;
log de búsquedas en Postgres (`backend/api/_tracking.js`, Neon por HTTP,
fail-open con timeout de 2s, `backend/sql/001_busquedas.sql`);
`/api/sample` con `canal`/`rechazado` y respuesta con `id`;
`/api/encuesta`; eventos GA4 + `web-vitals`; Clarity y Sentry (SRI); UI de
micro-encuesta. Los IDs públicos (`GA4_ID`, `CLARITY_ID`, `SENTRY_DSN`)
siguen como placeholder en `frontend/public/index.html`.

Desviaciones del diseño y del plan (por ruling): el opt-out también
detiene los rastreadores que ya corren a mitad de sesión (`stopTracking()`);
guarda de placeholders (no carga un proveedor cuyo ID no sea real); `canal`
es una bandera de un solo uso por búsqueda; Clarity va en el código, no en
un snippet aparte; `clarity('stop')` no está documentado por Microsoft;
`util` debe ser un booleano real. `backend/package.json` introduce la
primera dependencia npm (fija), por lo que hace falta `cd backend && npm
install` antes de `npm test`.

Pendiente, todo manual (Tarea 10): crear el proyecto Neon y aplicar el
esquema; poner los IDs reales de GA4, Clarity y Sentry; agregar el host de
ingest de Sentry al CSP; vincular GA4 a BigQuery; panel en Looker Studio;
revisión legal del texto del banner.

### 2026-11-15 — Rate limiting + caché compartido

Plan ejecutado: `docs/superpowers/plans/2026-11-15-ratelimit-cache-redis.md`.
Mergeado a `main` (fast-forward `8128871..7ca9399`), suite 25/25 verde.
Worktree y rama de feature ya borrados.

Qué quedó: `api/_estado.js` (Upstash Redis vía REST, sin librería) con
`cacheGet`/`cacheSet` (6h TTL) y `limitado` (20 req/10min por IP, un solo
pipeline INCR+EXPIRE NX), timeout de 2s en cada llamada a Redis, fail-open
total si Redis no está configurado o falla. `api/sample.js` ya no tiene
caché/rate-limit en memoria — delega todo a `_estado.js`. `CLAUDE.md`
actualizado con esto.

Desviación del diseño original: el rate limit de negocio (20/10min) se
movió a Redis en vez de `@vercel/firewall`, porque `checkRateLimit()`
depende de una regla configurada en el dashboard de un deployment real y
no se puede simular en `node --test` (ver diseño, sección "Rate limiting y
caché compartido", ya actualizada). `@vercel/firewall` queda como guarda
adicional de borde, configurable en Vercel, sin dependencia de código ni
de tests.

Pendiente, no bloqueante: 6 hallazgos menores diferidos en la revisión
final (ver `docs/superpowers/plans/2026-11-15-ratelimit-cache-redis.md` /
ledger del worktree, ya borrado — resumen: falta doc en README de las env
vars de Redis [ya cubierto ahora en CLAUDE.md], falta validar `!TOKEN`
además de `!BASE`, `pipeline()` no chequea `r.ok`, un test de "sin
KV_REST_API_URL" no borra también los alias `UPSTASH_*`, el test de
`{error}` solo cubre `limitado` no `cacheGet`, no hay límite de tamaño de
caché ahora que no es un `Map` acotado).

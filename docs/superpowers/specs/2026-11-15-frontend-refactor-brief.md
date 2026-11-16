# Brief para la próxima sesión: refactor del frontend y rediseño con el banner

Este documento es el punto de partida de una sesión nueva. No es un plan: el
plan paso a paso se escribe con `superpowers:writing-plans` después de
`superpowers:brainstorming`. Estado general del proyecto en
`2026-11-15-split-tracking-loadtest-EXECUTION.md`.

## Punto de partida (medido el 2026-11-15)

- `frontend/public/index.html`: 1323 líneas, 379 KB. Dos bloques `<style>`
  (líneas 1-43 y 48-465), dos `<script>` (529-534 y 535-1322), 16 handlers
  inline (`onclick=`, `onchange=`, `oninput=`) y cero `<script src>`.
- `frontend/public/data.json`: 3,7 MB (≈39 mil SKUs); `ai.json`: 165 KB. El
  navegador los baja al abrir la página para re-validar y puntuar los
  segmentos que devuelve el servidor y elegir los SKUs (`pickSkus` y otras
  ~68 funciones). La misma lógica existe en `backend/api/_engine.js` y
  `_catalog.js`: la duplicación que describe `CLAUDE.md`.
- CSP en `frontend/vercel.json`: `script-src 'self' 'unsafe-inline' ...`. El
  `'unsafe-inline'` existe porque todo el JavaScript es inline.
- El mapa SVG, el scoring, la voz, la ruta guiada, el banner, `initTracking()`
  y la micro-encuesta viven en ese único archivo.
- Producción de pruebas: `https://asistente-calle80-frontend.vercel.app`
  (proxy `/api/*` al backend con `rewrites` y destino fijo).

## Decisiones ya tomadas

- Primero se lanza el beta con este frontend; el refactor va después de
  tener datos del log de búsquedas (`busquedas` en Neon) que digan qué
  consultas son frecuentes.
- Astro no encaja bien: es una sola app interactiva, no un sitio de contenido.
  Si hace falta un build, la opción natural es Vite con JavaScript sin
  framework, o una librería ligera. La elección final queda abierta para la
  sesión nueva (ver "Preguntas abiertas").
- Orden recomendado (el frontend no se refactoriza antes de decidir dónde
  vive la lógica):
  1. Mover la selección de SKUs al backend: `/api/sample` devuelve la ruta ya
     resuelta con los SKUs y el cliente solo la dibuja. Quita la descarga de
     3,7 MB, elimina la duplicación del scoring y deja de publicar el
     catálogo como archivo. Cambia el contrato de `/api/sample`.
  2. Extraer el JavaScript a archivos y quitar `'unsafe-inline'` de
     `script-src`. Hay que revisar cómo se inyectan GA4, Clarity y Sentry.
  3. Rediseño y, si se justifica, bundler.

## Banner de tratamiento de datos: qué debe resolver el rediseño

Estado actual (`index.html`, `#consentBar`, línea 504): aviso fijo abajo, no
bloqueante, con dos botones ("Entendido", "Desactivar seguimiento").
`localStorage`: `calle80_banner_visto` y `calle80_tracking_rechazado`.
`initTracking()` es la única puerta que carga proveedores; `stopTracking()`
detiene lo ya cargado.

Brechas detectadas:
- El texto dice "Microsoft Clarity, Google Analytics y un registro de
  búsquedas" y **no menciona Sentry**, que ya está activo.
- No dice que Clarity graba la sesión y puede capturar lo que la persona
  escribe o dicta, ni qué datos guarda el log de búsquedas (texto, canal,
  proveedor, tiempo, IP según `_tracking.js`: revisar qué se persiste).
- No enlaza a una política de tratamiento de datos ni dice quién es el
  responsable (Ley 1581).
- Una vez rechazado, no hay forma visible de cambiar la decisión (no hay
  control "preferencias"); el banner no vuelve a aparecer.
- El texto legal está pendiente de revisión por el negocio o un abogado; no
  tratarlo como definitivo.

Requisitos de diseño: no bloquear el uso ni tapar el mapa ni los botones de
voz en celular; accesible (foco, `role`, contraste); sin romper el contrato
"rechazar apaga Clarity, GA4, Sentry y el log por igual"; el cliente sigue
mandando `rechazado` en `/api/sample`.

## Contratos que no se pueden romper

- Los códigos de error: el mapa `ERR` del cliente y los `error` de
  `backend/api/sample.js` (`ia_ocupada`, `error`, `network`, `timeout`,
  `refused`, `sampling_disabled`, `rate_limited`, `invalid_json`,
  `not_granted`, `session_expired`) son dos listas sin esquema compartido.
- `canal` (`texto`/`voz`), `rechazado` y el `id` de la búsqueda que el
  cliente devuelve a `/api/encuesta` con `util` booleano.
- La cadena de proveedores de IA y el respaldo al índice.
- Los IDs públicos `GA4_ID`, `CLARITY_ID`, `SENTRY_DSN` en `initTracking()`.

## Restricciones del entorno

- Vercel Hobby: solo despliega commits cuyo autor sea el dueño del equipo
  (`git config user.email` con su email verificado antes de commitear).
- `rewrites` no puede poner headers; el destino del backend está fijo en
  `frontend/vercel.json`. `routes` con `transforms` y `${BACKEND_URL}` dieron
  404 en este despliegue.
- Un frontend con build implica cambiar `outputDirectory`, el Build Command y
  probar de nuevo los headers de seguridad y el rewrite.
- No hay herramientas de lint ni de formato; la suite es `npm test` (49 casos,
  sin pruebas del frontend). Antes de refactorizar, hay que decidir cómo
  verificar el cliente (capturas de pantalla y una prueba en navegador).

## Preguntas abiertas para el brainstorming

1. ¿Vite sin framework, o una librería ligera? ¿Qué gana de verdad el equipo?
2. ¿Qué cambia en el diseño visual, y qué se conserva del mapa y la ruta
   guiada, que es lo más delicado?
3. ¿Se mueve primero la selección de SKUs al backend, o se hace el rediseño
   sobre el contrato actual?
4. ¿Qué datos del log y de Clarity del beta deben guiar el rediseño?
5. ¿Quién redacta la política de datos y cuándo estará revisada?

## Cómo empezar la sesión

1. Leer `CLAUDE.md`, este brief y `EXECUTION.md`.
2. Confirmar que el beta ya generó datos (`SELECT count(*) FROM busquedas;`) y
   mirar las búsquedas más frecuentes.
3. Invocar `superpowers:brainstorming` con las preguntas de arriba, luego
   `superpowers:writing-plans`.

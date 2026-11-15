# Split frontend/backend en dos proyectos Vercel + Trusted Sources/Protection Bypass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split el proyecto Vercel único actual (static `public/` + función `api/sample.js`) en dos proyectos Vercel dentro del mismo repo (monorepo), conectados por un rewrite, para que el backend pueda migrar de infraestructura después sin tocar el frontend — y configurar el acceso cross-project (Protection Bypass for Automation) para que ese rewrite funcione también en Preview, sin romper el dominio único que ve el navegador ni los headers de seguridad existentes.

**Architecture:** Dos directorios nuevos, `frontend/` y `backend/`, cada uno Root Directory de su propio proyecto Vercel con su propio `vercel.json`. El frontend es estático puro (sin función) y usa `rewrites` con un `transforms` por entrada para inyectar el header `x-vercel-protection-bypass` en las llamadas a `/api/*`, apuntando a `$BACKEND_URL` (env var con valor distinto en Production/Preview). El backend expone `api/sample.js` igual que hoy, solo que medido desde su nuevo Root Directory. Trusted Sources (OIDC) queda descartado: exige código de función en el llamador, y el frontend no tendrá función tras el split.

**Tech Stack:** Vercel (`vercel.json` `rewrites`/`transforms`/`headers`/`functions`), Node.js `require()` CommonJS, `node:test`, Python 3 (`scripts/build_destinos.py`), sin dependencias npm nuevas.

**Spec:** `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-design.md` (sección "Separar frontend/backend" + decisión "Trusted Sources / Protection Bypass for Automation"). Progreso general del frente en `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`.

## Global Constraints

- Preservar los headers de seguridad existentes en **todas** las rutas tras el split: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: frame-ancestors 'none'` (valores exactos de `vercel.json` actual).
- `NVIDIA_API_KEY`/`GEMINI_API_KEY` deben vivir solo en el proyecto backend, nunca en el frontend (restricción explícita del spec — anti-objetivo si se viola).
- No abrir CORS más de lo necesario entre frontend y backend (anti-objetivo explícito del spec).
- Trusted Sources / Protection Bypass entre los dos proyectos es un paso de configuración obligatorio, no opcional (decisión ya tomada en el spec) — sin él, el rewrite en Preview puede golpear silenciosamente la página de challenge de Vercel en vez del handler real.
- Cero cambios de código dentro de `api/*.js` o `public/index.html`: todas las referencias internas son relativas (`require('./_catalog')`, `__dirname`, fetch relativo a `data.json`/`ai.json`) — el split es un `git mv` de directorios, no un refactor.
- `BACKEND_URL` en Preview usa el alias fijo por rama de git (`<backend-project>-git-<branch>.vercel.app`) — confirmado con el usuario que las ramas feature siempre se pushean antes de probar Preview, así que esta forma es fiable aquí (no se necesita el fallback de "latest preview" rotativo).
- No tocar la lógica interna de `api/_estado.js` (caché/rate-limit en Redis, frente ya mergeado) — solo verificar que sus env vars viajen con él al proyecto backend.

## Review Focus

- Rewrite en Preview golpea la página de challenge de Vercel en vez del handler real (bypass mal configurado) y el fallo se ve "silencioso" — pocos errores, respuestas rápidas — porque en realidad se está midiendo el challenge, no `api/sample.js`. Cubierto en Tarea 6 comparando la forma del body JSON, no solo el status code.
- Los headers de seguridad desaparecen en respuestas proxeadas a través del rewrite (`/api/sample`) aunque sigan presentes en `/`. Cubierto en Tarea 6 con `curl -sI` a ambas rutas.
- `NVIDIA_API_KEY`/`GEMINI_API_KEY` quedan (por accidente) también configuradas en el proyecto frontend, violando la restricción de aislamiento de env vars. Cubierto en Tarea 5 con una auditoría explícita del listado de env vars del proyecto frontend.
- Las env vars de Redis (`KV_REST_API_URL`/`UPSTASH_REDIS_REST_URL` + tokens) no se migran al proyecto backend, y el fallo es silencioso (fail-open documentado: sin Redis, sigue respondiendo, solo sin caché/rate-limit). Cubierto en Tarea 6 con una prueba de dos requests idénticos consecutivos para confirmar que el segundo es cacheado.
- El `vercel.json` del frontend es rechazado por el validador de Vercel porque la forma exacta del objeto `transforms` no coincide con el schema actualmente desplegado (el campo `env` podría ir en la entrada del rewrite o en el transform, no se pudo confirmar al byte). Cubierto en Tarea 3 como paso explícito de verificación con plan de ajuste ante el mensaje de error de Ajv.

---

### Task 1: Mover el backend a `backend/` y actualizar referencias

**Files:**
- Move: `api/sample.js`, `api/_catalog.js`, `api/_destinos.json`, `api/_engine.js`, `api/_estado.js`, `api/_recorte.js`, `api/_vectores.bin`, `api/_vectores.json` → `backend/api/` (mismos nombres, `git mv api backend/api`)
- Create: `backend/vercel.json`
- Modify: `test/sample.test.js`, `test/estado.test.js`, `test/engine.test.js` (paths de `require`)
- Modify: `scripts/build_vectores.js` (paths de `require`/`writeFileSync`)
- Modify: `scripts/build_destinos.py` (path de `OUT`)

**Interfaces:**
- Produces: `backend/api/sample.js` sigue exportando lo mismo que `api/sample.js` exportaba hoy (handler de Vercel Function, sin cambios de firma). Las tareas 3 y 6 asumen que este módulo vive en esa ruta.

- [ ] **Step 1: Mover el directorio completo con git**

```bash
mkdir -p backend
git mv api backend/api
```

- [ ] **Step 2: Actualizar los tres `require()` rotos en `test/`**

En `test/sample.test.js:9`: `require('../api/sample')` → `require('../backend/api/sample')`.
En `test/estado.test.js:20` y `:98`: `require('../api/_estado')` → `require('../backend/api/_estado')` (las dos ocurrencias).
En `test/engine.test.js:4`: `require('../api/_engine')` → `require('../backend/api/_engine')`.

- [ ] **Step 3: Actualizar `scripts/build_vectores.js`**

Cambiar `require(path.join(ROOT, 'api', '_catalog'))` → `require(path.join(ROOT, 'backend', 'api', '_catalog'))`, y las dos escrituras `path.join(ROOT, 'api', '_vectores.bin'/'.json')` → `path.join(ROOT, 'backend', 'api', ...)`. `ROOT` (ya calculado como `path.resolve(__dirname, '..')`) no cambia.

- [ ] **Step 4: Actualizar `scripts/build_destinos.py`**

Cambiar `OUT = ROOT / 'api' / '_destinos.json'` → `ROOT / 'backend' / 'api' / '_destinos.json'`. `ROOT` no cambia. (La línea de `HTML`/`public/ai.json` se actualiza en la Tarea 2, junto con el resto de rutas de `public/`.)

- [ ] **Step 5: Crear `backend/vercel.json`**

```json
{
  "functions": {
    "api/sample.js": { "maxDuration": 60, "includeFiles": "api/_vectores.*" }
  }
}
```

Sin `outputDirectory` ni `headers`: el backend no sirve estáticos y el navegador nunca le pega directo, solo a través del rewrite del frontend.

- [ ] **Step 6: Correr la suite de tests**

Run: `npm test`
Expected: mismo conteo de pass/fail que antes del `git mv` (correr `npm test` una vez antes del Step 1 como baseline, para diff).

- [ ] **Step 7: Commit**

```bash
git add backend test scripts/build_vectores.js scripts/build_destinos.py
git commit -m "refactor: mover api/ a backend/ para el split de proyectos Vercel"
```

---

### Task 2: Mover el frontend a `frontend/` y actualizar referencias

**Files:**
- Move: `public/index.html`, `public/data.json`, `public/ai.json`, `public/empleada-inicio.jpg` → `frontend/public/` (`git mv public frontend/public`)
- Create: `frontend/vercel.json`
- Modify: `scripts/build_destinos.py` (paths de `HTML` y de la escritura de `ai.json`)
- Modify: `scripts/patch_mapa_laterales.py`, `scripts/patch_patio.py` (path de `HTML`)

**Interfaces:**
- Consumes: ninguna de Task 1.
- Produces: `frontend/public/index.html` sirve de `/`, con `fetch('data.json')`/`fetch('ai.json')` (relativos, sin cambios) y `fetch('/api/sample', ...)` (absoluto, interceptado por el rewrite de la Tarea 3).

- [ ] **Step 1: Mover el directorio completo con git**

```bash
git mv public frontend/public
```

- [ ] **Step 2: Actualizar `scripts/build_destinos.py`**

Cambiar `HTML = ROOT / 'public' / 'index.html'` → `ROOT / 'frontend' / 'public' / 'index.html'`, y la escritura de `(ROOT / 'public' / 'ai.json')` → `(ROOT / 'frontend' / 'public' / 'ai.json')`. `XLSX`/`MANUAL`/`LATERALES` (bajo `data/`) no cambian.

- [ ] **Step 3: Actualizar `scripts/patch_mapa_laterales.py` y `scripts/patch_patio.py`**

Cambiar `HTML = ROOT / 'public' / 'index.html'` → `ROOT / 'frontend' / 'public' / 'index.html'` en ambos.

- [ ] **Step 4: Crear `frontend/vercel.json`**

```json
{
  "outputDirectory": "public",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "$BACKEND_URL/api/$1",
      "env": ["BACKEND_URL"],
      "transforms": [
        {
          "type": "request.headers",
          "op": "set",
          "target": { "key": "x-vercel-protection-bypass" },
          "args": "$BACKEND_BYPASS_SECRET",
          "env": ["BACKEND_BYPASS_SECRET"]
        }
      ]
    }
  ]
}
```

Nota para quien ejecute esta tarea: si Vercel rechaza este `vercel.json` al desplegar (error de validación Ajv), el detalle del mensaje nombra la clave exacta que falla — lo más probable es que `"env": ["BACKEND_BYPASS_SECRET"]` deba subir del objeto `transforms` al array `env` de nivel rewrite (junto a `BACKEND_URL`) en vez de repetirse anidado. Ajustar y volver a desplegar; no es una decisión abierta, es un detalle verificable en el primer intento de deploy real (Tarea 6).

- [ ] **Step 5: Validar el JSON y correr los scripts de build**

Run: `node -e "require('./frontend/vercel.json')"` (valida que parsea)
Run: `python -X utf8 scripts/build_destinos.py` y `node scripts/build_vectores.js`
Expected: ambos corren sin error y escriben en las nuevas rutas (`frontend/public/ai.json`, `backend/api/_destinos.json`, `backend/api/_vectores.*`).

- [ ] **Step 6: Commit**

```bash
git add frontend scripts/build_destinos.py scripts/patch_mapa_laterales.py scripts/patch_patio.py
git commit -m "refactor: mover public/ a frontend/ y añadir rewrite al backend"
```

---

### Task 3: Eliminar el `vercel.json` raíz y sincronizar la documentación

**Files:**
- Delete: `vercel.json` (raíz)
- Modify: `CLAUDE.md`, `README.md` (toda mención de `api/_x.js`, `public/index.html`, `vercel.json` raíz → rutas con prefijo `backend/`/`frontend/`)

**Interfaces:**
- Consumes: Tasks 1 y 2 completas (el `vercel.json` raíz ya no tiene destino válido una vez movidos `api/` y `public/`).

- [ ] **Step 1: Borrar el `vercel.json` raíz**

```bash
git rm vercel.json
```

- [ ] **Step 2: Actualizar `CLAUDE.md` y `README.md`**

Reemplazar cada ruta mencionada (`api/sample.js` → `backend/api/sample.js`, `public/index.html` → `frontend/public/index.html`, etc.) y añadir una frase breve en la sección de Arquitectura de `CLAUDE.md` describiendo los dos proyectos Vercel y el rewrite (sin repetir todo el diseño del spec, solo el estado actual del repo).

- [ ] **Step 3: Confirmar que no quedan referencias a las rutas viejas**

Run: `grep -rn "'api/" scripts/ test/ --include=*.js --include=*.py` y `grep -n "public/" CLAUDE.md README.md`
Expected: cero resultados que no tengan ya el prefijo `backend/`/`frontend/`.

- [ ] **Step 4: Correr la suite de tests una última vez sobre el árbol final**

Run: `npm test`
Expected: mismo resultado que el baseline de la Tarea 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: sincronizar CLAUDE.md y README.md con la nueva estructura backend/frontend"
```

---

### Task 4: Dar de alta el proyecto backend en Vercel y verificarlo de forma aislada

**Files:** ninguno (pasos de dashboard/CLI de Vercel, no hay archivos de repo que tocar).

**Interfaces:**
- Consumes: `backend/vercel.json` y `backend/api/*` de la Tarea 1.
- Produces: una URL de proyecto backend (p.ej. `https://calle80-backend.vercel.app` en Production, `https://calle80-backend-git-<branch>.vercel.app` en Preview) que la Tarea 5 usará como valor de `BACKEND_URL`.

- [ ] **Step 1: Importar el proyecto backend**

En el dashboard de Vercel (o `vercel link` desde dentro de `backend/`): "Add New Project" → importar este mismo repo → Root Directory = `backend/` → nombre del proyecto, p.ej. `calle80-backend`.

- [ ] **Step 2: Migrar las env vars del backend**

Copiar al nuevo proyecto backend (Production + Preview, como ya estaban): `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_MODEL`, `GEMINI_MODEL`, `KV_REST_API_URL`/`UPSTASH_REDIS_REST_URL`, `KV_REST_API_TOKEN`/`UPSTASH_REDIS_REST_TOKEN`.

- [ ] **Step 3: Desplegar y verificar en directo (sin rewrite todavía)**

Run: `curl -s -X POST https://<backend-preview-url>/api/sample -H "Content-Type: application/json" -d '{"text":"martillo"}'`
Expected: body JSON con la forma documentada en CLAUDE.md (clave `segs`/`error`/`respaldo`), o un 401/challenge de Vercel si Deployment Protection ya está activo por defecto — en ese caso es esperado en este paso (la Tarea 5 lo resuelve); solo confirmar que el deploy en sí no está roto antes de seguir.

- [ ] **Step 4: Confirmar que las env vars de Redis llegaron**

No hay forma directa de verificarlo sin pasar por el rewrite; queda confirmado junto con la Tarea 6 (prueba de dos requests idénticos para ver caché).

---

### Task 5: Configurar Protection Bypass for Automation y las env vars del frontend

**Files:** ninguno (dashboard de Vercel).

**Interfaces:**
- Consumes: proyecto backend de la Tarea 4.
- Produces: `BACKEND_BYPASS_SECRET` y `BACKEND_URL` configurados en el proyecto frontend, listos para que la Tarea 6 despliegue el rewrite.

- [ ] **Step 1: Generar el secreto en el backend**

En el proyecto backend → Settings → Deployment Protection → "Protection Bypass for Automation" → generar secreto. Vercel lo expone automáticamente como `VERCEL_AUTOMATION_BYPASS_SECRET` en las deployments del backend — no hace falta tocarlo ahí.

- [ ] **Step 2: Copiar el secreto al frontend con otro nombre**

En el proyecto frontend (aún no existe hasta la Tarea 6, pero puede crearse ya solo para configurar env vars, o configurarse en el mismo paso de la Tarea 6) → env var `BACKEND_BYPASS_SECRET` = el valor copiado, scope Production + Preview. Nombre distinto de `VERCEL_AUTOMATION_BYPASS_SECRET` a propósito: si el frontend alguna vez activa su propio Protection Bypass, Vercel pondría su propio `VERCEL_AUTOMATION_BYPASS_SECRET` ahí y colisionaría con este.

- [ ] **Step 3: Configurar `BACKEND_URL` por entorno**

Production → dominio de producción del backend. Preview → `https://<backend-project>-git-<branch>.vercel.app` (alias fijo por rama, confirmado como fiable para este repo).

- [ ] **Step 4: Auditar que las claves del backend no quedaron en el frontend**

Revisar el listado de env vars del proyecto frontend: `NVIDIA_API_KEY`/`GEMINI_API_KEY` y las variables de Redis no deben aparecer ahí bajo ningún nombre.

---

### Task 6: Dar de alta el proyecto frontend, desplegar el rewrite y verificar extremo a extremo

**Files:** ninguno (dashboard/CLI de Vercel + comandos de verificación).

**Interfaces:**
- Consumes: `frontend/vercel.json` (Tarea 2), proyecto backend + env vars (Tareas 4 y 5).

- [ ] **Step 1: Importar el proyecto frontend**

Dashboard → "Add New Project" → mismo repo → Root Directory = `frontend/` → nombre, p.ej. `calle80-frontend`. Con `BACKEND_URL`/`BACKEND_BYPASS_SECRET` ya configurados (Tarea 5) antes de este primer deploy.

- [ ] **Step 2: Verificar que el rewrite llega al handler real, no al challenge**

Run: `curl -i -X POST https://<frontend-preview-url>/api/sample -H "Content-Type: application/json" -d '{"text":"martillo"}'`
Expected: 200 con JSON cuya forma coincide con el contrato documentado en CLAUDE.md (no un body HTML de challenge ni un `Location:` hacia un dominio de `vercel.com`). Si aparece el challenge: revisar que `BACKEND_BYPASS_SECRET` tiene el mismo valor que el secreto generado en el backend, y que el `vercel.json` del frontend no fue rechazado silenciosamente (ver nota de la Tarea 2, Step 4).

- [ ] **Step 3: Verificar los headers de seguridad en ambas rutas**

Run: `curl -sI https://<frontend-preview-url>/` y `curl -sI https://<frontend-preview-url>/api/sample`
Expected: ambas respuestas incluyen `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `content-security-policy: frame-ancestors 'none'`.

- [ ] **Step 4: Verificar el caché/rate-limit de Redis a través del rewrite**

Run: el mismo `curl` del Step 2 dos veces seguidas con el mismo body.
Expected: la segunda respuesta es notablemente más rápida (cache hit) — confirma que las env vars de Redis llegaron al backend y siguen funcionando igual que antes del split.

- [ ] **Step 5: Verificar el cliente real en navegador**

Abrir `https://<frontend-preview-url>/`, confirmar que `data.json`/`ai.json` cargan (200) y que una búsqueda real de producto devuelve resultados (no un mensaje del mapa `ERR`).

- [ ] **Step 6: Verificar la degradación esperada ante un rewrite roto**

Cambiar temporalmente `BACKEND_URL` del entorno Preview a un valor inválido, redesplegar, repetir una búsqueda en el navegador.
Expected: el cliente muestra el mensaje `network`/`timeout` del mapa `ERR` (CLAUDE.md), no una excepción JS sin manejar. Revertir `BACKEND_URL` al valor correcto y redesplegar.

---

### Task 7: Cutover de producción

**Files:** ninguno (dashboard de Vercel / DNS).

**Interfaces:**
- Consumes: Tarea 6 verificada en Preview.

- [ ] **Step 1: Apuntar el dominio de producción al nuevo proyecto frontend**

Reasignar el dominio real del proyecto Vercel único actual al nuevo proyecto `calle80-frontend`.

- [ ] **Step 2: Verificar producción con los mismos checks de la Tarea 6**

Repetir los Steps 2, 3 y 5 de la Tarea 6 contra el dominio de producción.

- [ ] **Step 3: Confirmar el plan de rollback antes de dar por cerrado el frente**

Confirmar que reasignar el dominio de vuelta al proyecto único anterior sigue siendo posible (ese proyecto no se borra en este frente) hasta que la Tarea 7 lleve, sin incidentes, el tiempo que el usuario considere suficiente.

- [ ] **Step 4: Actualizar `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`**

Marcar como hechos los dos checklist items ("Separar frontend/backend..." y "Trusted Sources / Protection Bypass...") y añadir una entrada fechada con cualquier desviación respecto a este plan (p.ej. si el shape exacto de `transforms` tuvo que ajustarse en la Tarea 2/6).

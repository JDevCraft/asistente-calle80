# Tracking de beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the beta a structured, consented view of what customers search for and how the assistant answers — per-search logging to Postgres, Clarity, GA4 + Core Web Vitals, Sentry, a non-blocking opt-out consent banner, and a one-question micro-survey tied to each search row — without touching the load test or the Vercel-project-split cutover (tracked elsewhere).

**Architecture:** A new `backend/api/_tracking.js` module (same fail-open/timeout/`global.fetch`-mockable shape as `backend/api/_estado.js`) writes one row per search to Postgres via `@neondatabase/serverless`'s HTTP-fetch driver, and one update per survey answer. `backend/api/sample.js` gains an `id` per request, a `proveedor` tag, and a single `registrar()` choke point called before every existing response. `frontend/public/index.html` gains one `initTracking()` gate, checked once at page load against two `localStorage` flags, that either does nothing or creates `<script>` tags for Clarity, gtag.js, `web-vitals`, and Sentry — plus a bottom-fixed consent bar (not the existing modal `.pop`), a `window.__canalBusqueda` flag read by the search request, and a micro-survey rendered after a route shows.

**Tech Stack:** Node.js `>=20`, CommonJS, `node:test` (no frontend test runner exists or is added by this plan), `@neondatabase/serverless` (first real npm dependency, scoped to a new `backend/package.json`), vanilla JS in `index.html` (no bundler, no `<script src>` baked into HTML — only dynamically created tags), GA4/gtag.js, Microsoft Clarity, Sentry (`@sentry/browser` via CDN), `web-vitals` (CDN), Postgres (Neon).

**Saved copy:** on approval, this plan is written verbatim to `docs/superpowers/plans/2026-11-15-tracking-beta.md` (the repo's plan convention) before Task 1 starts.

**Spec:** `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-design.md` — sections "Banner de tratamiento de datos", "Centralización de datos", "Fuentes de datos complementarias", "Decisiones ya tomadas", "Lo que queda a criterio de quien lo construya". Out of scope: the k6/Artillery load test and the Vercel-project-split cutover, tracked in `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`.

## Global Constraints

- Node.js `>=20`, CommonJS (`require`/`module.exports`) everywhere — no ESM, no bundler, no lint/format tooling.
- Root `package.json` stays at zero `dependencies`. `@neondatabase/serverless` is added only to a new `backend/package.json` — `frontend/` stays dependency-free.
- No static `<script src>` in `index.html`. Clarity, gtag.js, `web-vitals`, and `@sentry/browser` all load through dynamically created `<script>` elements inside one `initTracking()` function, called once at page load.
- Opt-out model is fixed, not open for debate: trackers start by default; `calle80_banner_visto` (set on any dismissal) controls whether the bar shows again; `calle80_tracking_rechazado` (set only by "Desactivar seguimiento") is checked once, before `initTracking()` does anything, and must suppress Clarity, GA4, *and* the structured log equally.
- The banner copy shipped by this plan is a defensible placeholder, not legally reviewed. Say so wherever the copy appears (Task 2, Global Constraints here, Task 10's checklist) — Ley 1581 review is a business/legal step this plan flags but cannot close.
- CSP grows by the minimal allowlist the three vendors + the `web-vitals` CDN need; `frame-ancestors 'none'` stays; no new `default-src`, `style-src`, or `frame-src` restriction is introduced (none of the four scripts need one, and inventing one would also have to cover the page's two pre-existing inline `<style>` blocks and its Google Fonts `<link>`, which is out of scope here).
- All new backend network calls (Postgres via Neon) are mockable via `global.fetch` exactly like `backend/api/_estado.js`, fail open (never throw up to the caller), and carry a bounded `AbortSignal.timeout`.
- The `rapido()` no-AI response path may grow one more bounded, fail-open network call (consistent with the Redis cache/rate-limit calls it already absorbed) — it must not gain a second blocking dependency.
- No DOM/browser test runner exists in this repo. Frontend-only steps (banner, `initTracking()`, GA4/CWV/Sentry wiring, micro-survey UI) are verified with a documented manual browser QA checklist instead of `node --test`, not with an invented automated test.
- `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md` gets updated per completed frente, per its own stated convention.

## Review Focus

- Rejecting tracking mid-session: once `calle80_tracking_rechazado` is set, every later `/api/sample` call must carry `rechazado: true` and the server must skip the Postgres write — even though whatever Clarity/GA4 already captured before the click can't be un-sent. The test is on the server side: `rechazado: true` must suppress `registrarBusqueda` regardless of other fields.
- Postgres unreachable or `POSTGRES_URL`/`DATABASE_URL` unset: `registrarBusqueda`/`registrarEncuesta` must no-op without throwing, same as `_estado.js` degrades without Redis — and `/api/sample`/`/api/encuesta` must still return their normal success response.
- `localStorage` unavailable (private browsing, quota, disabled) must not crash `initTracking()` or the banner — wrap every read/write in `try/catch` and default to "not yet shown" / "not rejected" behavior.
- A stale or unknown `id` posted to `/api/encuesta` (typo, expired row, row never logged because the search was rejected) must still return 200 — a lost survey answer isn't worth failing the request.
- The `rapido()` cheap path must stay cheap: adding `registrar()` to it is accepted cost, but only if it's bounded by the same fail-open timeout discipline as the Redis calls already on that path — not a second hard dependency.

---

## File Structure

- Create: `backend/package.json` — declares `@neondatabase/serverless` for the backend project only.
- Create: `backend/sql/001_busquedas.sql` — the `busquedas` table schema, run manually once against Neon (Task 10).
- Create: `backend/api/_tracking.js` — `registrarBusqueda`/`registrarEncuesta`, same fail-open shape as `_estado.js`.
- Create: `backend/api/encuesta.js` — `POST {id, util}` survey endpoint.
- Create: `test/tracking.test.js`, `test/encuesta.test.js`.
- Modify: `backend/api/sample.js` — `id`/`proveedor`/`canal`/`rechazado` handling, one `registrar()` choke point called before every existing response.
- Modify: `test/sample.test.js` — extends the existing `fetch` mock to also answer Neon's HTTP calls.
- Modify: `frontend/public/index.html` — consent bar markup/CSS/JS, `initTracking()`, `window.__canalBusqueda`, GA4/CWV/Sentry wiring, micro-survey UI, `/api/sample` and `/api/encuesta` fetch bodies.
- Modify: `frontend/vercel.json` — CSP allowlist.
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`.

### Task 1: CSP allowlist for Clarity, GA4, Sentry, and the web-vitals CDN

**Files:**
- Modify: `frontend/vercel.json:3-11` (the single `Content-Security-Policy` header value)

**Interfaces:**
- Produces: the exact `script-src`/`connect-src` values every later task's `<script>` tags and `fetch`/beacon calls must stay inside.

- [ ] **Step 1: Decide and write the new header value**

Today's header is just `"frame-ancestors 'none'"` — nothing restricts scripts or connections yet, so nothing is "opened" by adding these two directives, but they must be scoped tightly. Replace the single-value header with:

```
frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://browser.sentry-cdn.com https://cdn.jsdelivr.net; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.clarity.ms https://*.clarity.ms https://*.ingest.sentry.io https://*.ingest.us.sentry.io
```

The `'unsafe-inline'` on `script-src` is unavoidable here, not a shortcut: `index.html` has no bundler and no server-side templating step that could stamp a per-request nonce onto its two existing inline `<script>` blocks (one ~227k-char minified map module, one the ~700-line app script), so a strict `script-src` without it would break the entire page on the next deploy. What this CSP change still buys is real: it stops a reflected-XSS payload from pulling in a `<script src>` from an attacker-controlled domain, and it is the explicit minimal allowlist the anti-objective asks for instead of leaving `script-src` unset entirely. `img-src`/`style-src`/`frame-src` are left untouched — none of the four vendors need them, and adding one now would also have to account for the page's existing Google Fonts stylesheet and inline styles, which is outside this plan's scope.

Flag explicitly in the commit/PR: the Clarity, GA4, and `cdn.jsdelivr.net` domains above are the commonly documented ones as of today, but Sentry's ingest host is project-specific — verify both lists against the vendor's current CSP docs once the Sentry DSN exists (Task 10), and swap the Sentry wildcard for the real `ingest.*.sentry.io` host the created project assigns.

- [ ] **Step 2: Validate the file is still well-formed JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('frontend/vercel.json','utf8'))"`
Expected: no output, exit code 0.

- [ ] **Step 3: Manual verification (no automated test exists for Vercel headers)**

On the next frontend preview deploy, open devtools Network tab, confirm the `Content-Security-Policy` response header matches Step 1's value, and confirm no CSP violation appears in the console once Tasks 5-7's scripts are wired in.

- [ ] **Step 4: Commit**

```bash
git add frontend/vercel.json
git commit -m "feat: allowlist Clarity/GA4/Sentry/web-vitals in CSP"
```

### Task 2: Consent/opt-out core — `localStorage` flags, banner, `initTracking()` gate

**Files:**
- Modify: `frontend/public/index.html` (new CSS block near the existing banner/pop styles around line 174; new markup near the body's existing `.pop` markup around line 489; new JS near the top of the main `<script>` block that starts at line 520, and at the end of it near line 1230-1233)

**Interfaces:**
- Produces: `calle80_banner_visto` / `calle80_tracking_rechazado` (`localStorage` keys, string `'1'`/absent), `initTracking()` (no args, called once at page load, no return value — does nothing if `calle80_tracking_rechazado` is `'1'`), a safe `localStorage` wrapper (e.g. `lsGet(k)`/`lsSet(k,v)` that never throws).
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the safe localStorage helpers and the two flags**

```js
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
```

- [ ] **Step 2: Add the consent bar markup and CSS**

A bottom-fixed `<div id="consentBar">` (not `.pop`/`.pop-card` — no `role="dialog"`, no `aria-modal`, no focus trap), hidden by default, with the placeholder copy and two buttons:

> "Usamos Microsoft Clarity, Google Analytics y un registro de búsquedas para mejorar el asistente durante la beta. **[Entendido]** **[Desactivar seguimiento]**"

Mark this copy with an HTML comment noting it is not legally reviewed (Ley 1581) and must not ship to real beta traffic unchanged without business/legal sign-off (Task 10).

- [ ] **Step 3: Wire the bar's show/dismiss logic**

```js
function initConsentBar(){
  if (lsGet('calle80_banner_visto')) return;
  const bar = document.getElementById('consentBar'); if (!bar) return;
  bar.hidden = false;
  document.getElementById('consentOk').onclick = () => { lsSet('calle80_banner_visto','1'); bar.hidden = true; };
  document.getElementById('consentOff').onclick = () => { lsSet('calle80_banner_visto','1'); lsSet('calle80_tracking_rechazado','1'); bar.hidden = true; };
}
```

- [ ] **Step 4: Write the `initTracking()` gate (empty body for now — Tasks 5-7 fill it in)**

```js
function initTracking(){
  if (lsGet('calle80_tracking_rechazado')) return;
  // Clarity/gtag/web-vitals/Sentry script injection added in Tasks 5-7
}
```

Call both `initConsentBar()` and `initTracking()` once, at the same point the existing bootstrap `Promise.all(['data.json','ai.json']...)` callback finishes (right before the `setStatus('Tú lo describes, nosotros lo encontramos.');` call that closes that callback — currently at line 1230).

- [ ] **Step 5: Manual QA (no automated DOM test exists)**

In a browser devtools console: clear both keys, reload — confirm the bar shows. Click "Entendido" — confirm it hides and `calle80_banner_visto` is set, `calle80_tracking_rechazado` is not. Reload — confirm the bar does not show again. Clear both keys, reload, click "Desactivar seguimiento" — confirm both keys are set and the bar hides. Set `calle80_tracking_rechazado` manually and reload — confirm `initTracking()` creates zero `<script>` elements (`document.querySelectorAll('script[data-tracking]').length === 0`, once Tasks 5-7 tag their injected scripts with `data-tracking`).

- [ ] **Step 6: Commit**

```bash
git add frontend/public/index.html
git commit -m "feat: add opt-out consent bar and initTracking() gate"
```

### Task 3: `backend/package.json` + `@neondatabase/serverless` + `_tracking.js`

**Files:**
- Create: `backend/package.json`
- Create: `backend/sql/001_busquedas.sql`
- Create: `backend/api/_tracking.js`
- Test: `test/tracking.test.js`

**Interfaces:**
- Produces: `registrarBusqueda(datos: {id, texto, canal, resultado, proveedor, motivoRespaldo, tiempoRespuestaMs, ip}): Promise<void>`, `registrarEncuesta(id: string, util: boolean): Promise<void>` — exported from `backend/api/_tracking.js`, consumed by Task 4 and Task 5.
- Consumes: nothing from earlier tasks.

This is the one place this plan asks you to spike before writing the test: `@neondatabase/serverless`'s `neon(connectionString)` tagged-template function is documented to issue plain HTTPS `fetch` requests rather than the Postgres wire protocol (which is why this driver, and not a TCP client, keeps `node --test` mockable the same way `_estado.js` already is) — but the exact request shape (URL path, headers, body encoding) is version-specific and not worth guessing. Before writing the mock in Step 1, run one real `sql\`select 1\`` against a scratch Neon branch with `global.fetch` monkey-patched to `console.log(url, opts)` first, then hard-code that observed shape into the test's fake `fetch`.

- [ ] **Step 1: Write `backend/package.json`**

`private: true`, `engines.node: ">=20"`, `dependencies: { "@neondatabase/serverless": "<latest stable version at install time>" }`. No `scripts` needed — `npm test` still runs from the repo root.

- [ ] **Step 2: Write the schema file**

`backend/sql/001_busquedas.sql`, one `CREATE TABLE busquedas` statement with the spec's required minimum plus the survey field:

```sql
CREATE TABLE busquedas (
  id uuid PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  texto text NOT NULL,
  canal text NOT NULL CHECK (canal IN ('voz','texto')),
  resultado text NOT NULL CHECK (resultado IN ('indice','modelo','respaldo','error')),
  proveedor text CHECK (proveedor IN ('nvidia','gemini')),
  motivo_respaldo text,
  tiempo_respuesta_ms integer,
  ip text,
  util boolean
);
```

`id` is app-generated (`crypto.randomUUID()` in Task 4), not a DB serial, because the client needs it back before the survey fires. `resultado`'s four values rename the spec's open "directo/IA/respaldo/error" wording to `indice`/`modelo`/`respaldo`/`error` for clarity — same four buckets, closing the schema choice the spec left open.

- [ ] **Step 3: Write the failing tests**

```js
// test/tracking.test.js
process.env.POSTGRES_URL = 'https://fake-neon.test/sql';
const test = require('node:test'), assert = require('node:assert');
global.fetch = async (url, opts) => { /* mock matching Step 0's observed shape; returns {rows:[...]} or similar */ };
const { registrarBusqueda, registrarEncuesta } = require('../backend/api/_tracking');

test('registrarBusqueda sin POSTGRES_URL/DATABASE_URL configurado no lanza', async () => { /* delete both env vars, require fresh, call, assert resolves */ });
test('registrarBusqueda con fetch que falla no lanza (fail-open)', async () => { /* global.fetch rejects; assert.doesNotReject */ });
test('registrarEncuesta con fetch que falla no lanza (fail-open)', async () => { /* same */ });
test('registrarBusqueda feliz: hace la llamada esperada con los campos dados', async () => { /* assert on captured url/body */ });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test test/tracking.test.js`
Expected: FAIL — `Cannot find module '../backend/api/_tracking'`.

- [ ] **Step 5: Implement `_tracking.js`**

Same posture as `_estado.js`: a module-level `CONN = process.env.POSTGRES_URL || process.env.DATABASE_URL`, a 2s-class `AbortSignal.timeout` wrapped into whatever option Neon's client takes (per the spike), every exported function wrapped in `try { ... } catch (e) { console.error('tracking <fn>', e && e.message); }` and a `if (!CONN) return;` guard at the top of each, never throwing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/tracking.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/sql/001_busquedas.sql backend/api/_tracking.js test/tracking.test.js
git commit -m "feat: add Postgres structured-log module via Neon's HTTP driver"
```

Note the reason this dependency lands in a new `backend/package.json` rather than the repo root or `frontend/`: the root `package.json` declaring zero `dependencies` is a constraint this plan preserves, `frontend/` has no reason to ever import a Postgres driver, and `backend/` is already its own Vercel project root — scoping the dependency there is the natural boundary, and it's exactly why `npm test` from the repo root will need `backend/node_modules` to exist (Node's resolution walks up from `test/` through `backend/api/` looking for it) — see Task 9 for the `CLAUDE.md` command this requires.

### Task 4: `sample.js` wiring — `canal`, `rechazado`, `proveedor`, one `registrar()` choke point, `id` in the response

**Files:**
- Modify: `backend/api/sample.js:136-203`
- Modify: `test/sample.test.js`
- Modify: `frontend/public/index.html` (mic IIFE around lines 1056-1217, `ask()`/`askBtn.onclick` around lines 1013-1054, `sampleFn` fetch at line 1223)

**Interfaces:**
- Consumes: `registrarBusqueda` from Task 3 (`backend/api/_tracking.js`).
- Produces: `window.__canalBusqueda: 'voz'|'texto'` (frontend global, read at submit time); `/api/sample` request body gains `canal` and `rechazado`; `/api/sample` response body gains `id` (only present when the row was actually logged).

- [ ] **Step 1: Frontend — set `window.__canalBusqueda` right before the mic module triggers submit**

In the mic IIFE's `submit()` (line 1101), set `window.__canalBusqueda = 'voz';` before calling `$('askBtn').click()`. In `$('askBtn').onclick` (line 1054), reset `window.__canalBusqueda = 'texto'` at the top of the handler — `submit()` overwrites it to `'voz'` immediately before the click it triggers, so manual clicks/Enter default back to `'texto'`.

- [ ] **Step 2: Frontend — include `canal` and `rechazado` in the `/api/sample` request body**

In `sampleFn.json()` (line 1223), change the `fetch` body to:

```js
body: JSON.stringify({ text: A.text, answers: A.answers, canal: window.__canalBusqueda || 'texto', rechazado: !!lsGet('calle80_tracking_rechazado') })
```

- [ ] **Step 3: Write the failing backend tests**

Extend `test/sample.test.js`'s `global.fetch` mock to also answer Neon's URL (reuse Task 3's observed shape, or stub `_tracking.js` itself — simplest: mock `require('../backend/api/_tracking')` via `require.cache` substitution so this test file stays focused on `sample.js`'s own logic, not re-testing `_tracking.js`). New assertions:

```js
test('canal por defecto es texto si no se manda', async () => { /* run(...) sin canal; inspeccionar el registro simulado */ });
test('canal "voz" se propaga al registro', async () => { /* run con body.canal:'voz' */ });
test('rechazado:true suprime el registro pero no cambia la respuesta al cliente', async () => { /* run con rechazado:true; respuesta normal, sin "id" */ });
test('respuesta exitosa incluye "id" cuando no está rechazado', async () => { /* assert typeof r.body.id === "string" */ });
test('proveedor queda "nvidia" cuando NVIDIA responde, "gemini" cuando NVIDIA falla y Gemini responde', async () => { /* inspeccionar el registro simulado en cada escenario existente */ });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test test/sample.test.js`
Expected: FAIL (no `id` field yet, no registro captured).

- [ ] **Step 5: Implement in `backend/api/sample.js`**

Right after `const ip = ...` (line 139), add:

```js
const id = require('crypto').randomUUID();
```

Right after `body` is parsed, read `canal`/`rechazado`:

```js
const canal = body.canal === 'voz' ? 'voz' : 'texto';
const rechazado = !!body.rechazado;
```

Add the choke-point helper (placed after `t0` is defined at line 148, before the rápido check):

```js
const registrar = async extra => { if (!rechazado) await registrarBusqueda({ id, texto: text, canal, ip, tiempoRespuestaMs: Date.now() - t0, ...extra }); };
```

`registrar` is **awaited** before each response, never fire-and-forget: on Vercel's Node runtime, a promise still pending after `res.json()` may be frozen with the instance and the row silently lost. `registrarBusqueda` already never throws and carries its own 2s timeout (Task 3), so awaiting it is bounded exactly like the existing `cacheGet`/`limitado` calls. Consequently `respaldo()` becomes `async` (its 6 call sites already `return respaldo(...)` from the async handler, so no call site changes).

Call `await registrar({ resultado: 'indice' })` right before the rápido direct-hit response (line 151); inside the `respaldo()` closure (lines 154-158), `await registrar({ resultado: 'respaldo', motivoRespaldo: error })` before its laxo-index-hit response and `await registrar({ resultado: 'error', motivoRespaldo: error })` before its plain-failure response — this covers all 6 existing `respaldo()` call sites (lines 159, 165, 182, 187, 189, 201) through the one closure, no need to touch each call site; call `registrar({ resultado: 'modelo' })` before the cache-hit response (line 164 — `proveedor` intentionally omitted here, since the cached value doesn't retain which provider produced it, and decision #6 keeps `proveedor` server-log-only, never threaded into the cached/client response shape); add `let proveedor = null;` before the NVIDIA call (line 179), set it to `'nvidia'` right after `llamarNvidia` returns a truthy `out`, and to `'gemini'` right after the Gemini branch's `out = g.out` (line 183) is truthy; call `registrar({ resultado: 'modelo', proveedor })` before the success response (line 198). Every non-error response (`res.status(200)` at lines 151, 156, 164, 198) adds `id: rechazado ? undefined : id` alongside its existing fields — `JSON.stringify` drops an `undefined` property, so this satisfies "only present when logged" without an extra branch at each call site.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/sample.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/api/sample.js test/sample.test.js frontend/public/index.html
git commit -m "feat: tag every /api/sample response with id/canal/proveedor and log it"
```

### Task 5: `/api/encuesta` endpoint + micro-survey round trip

**Files:**
- Create: `backend/api/encuesta.js`
- Test: `test/encuesta.test.js`

**Interfaces:**
- Consumes: `registrarEncuesta(id, util)` from Task 3.
- Produces: `POST /api/encuesta {id: string, util: boolean}` → `200 {}` always (fail-open, per Review Focus).

- [ ] **Step 1: Write the failing tests**

```js
test('método distinto de POST → 405', async () => { /* ... */ });
test('{id, util} válidos → 200, registrarEncuesta llamado con esos valores', async () => { /* mock _tracking */ });
test('id desconocido o Postgres caído → igual 200 (no falla la petición por una encuesta perdida)', async () => { /* mock registrarEncuesta para que rechace */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/encuesta.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/api/encuesta.js`**

Mirrors `sample.js`'s method/body-parsing style; reads `{id, util}`, calls `registrarEncuesta(id, !!util).catch(() => {})`, always responds `res.status(200).json({})`. No `backend/vercel.json` entry needed — only `sample.js` needs the non-default `maxDuration`/`includeFiles`; new files under `backend/api/` pick up Vercel's default function config automatically.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/encuesta.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/encuesta.js test/encuesta.test.js
git commit -m "feat: add /api/encuesta survey endpoint"
```

### Task 6: GA4 taxonomy + Core Web Vitals, inside `initTracking()`

**Files:**
- Modify: `frontend/public/index.html` (`initTracking()` from Task 2; `ask()` around lines 1013-1038; `renderPlan()` around line 783)

**Interfaces:**
- Consumes: `initTracking()`'s gate from Task 2.
- Produces: GA4 events `search_submit {canal}`, `search_result {resultado, canal, ms}`, `route_view {}`, `web_vital {metric, value, id}`. `search_result`'s `resultado` is derived client-side exactly as `ask()` already distinguishes it (`A.ruta.respaldo` → `'respaldo'`, `A.ruta.fuente==='indice'` → `'indice'`, else `'modelo'`; a thrown error → `'error'`). `proveedor` is deliberately **not** a GA4 param — decision #6 keeps it server-side-only, never added to the client response Task 4 produces, so GA4 (client-only, no Measurement Protocol) has no way to know it.

- [ ] **Step 1: Load gtag.js and `web-vitals` inside `initTracking()`**

```js
function initTracking(){
  if (lsGet('calle80_tracking_rechazado')) return;
  const GA4_ID = 'G-XXXXXXX'; // público, no secreto — ver nota en CLAUDE.md
  const s1 = document.createElement('script'); s1.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID; s1.dataset.tracking = '1'; document.head.appendChild(s1);
  window.dataLayer = window.dataLayer || []; window.gtag = function(){ dataLayer.push(arguments); };
  gtag('js', new Date()); gtag('config', GA4_ID);
  const s2 = document.createElement('script'); s2.src = 'https://cdn.jsdelivr.net/npm/web-vitals@4/dist/web-vitals.iife.js'; s2.dataset.tracking = '1';
  s2.onload = () => { webVitals.onCLS(reportVital); webVitals.onINP(reportVital); webVitals.onLCP(reportVital); };
  document.head.appendChild(s2);
  // Clarity (Task 10) / Sentry (Task 7) injected here too
}
function reportVital(m){ if (window.gtag) gtag('event', 'web_vital', { metric: m.name, value: Math.round(m.value), id: m.id }); }
```

Comment the `GA4_ID` constant (and every sibling tracking ID added in Tasks 7/10) as public/client-visible, unlike every env var in this repo — this is the new category Task 9 adds to `CLAUDE.md`.

- [ ] **Step 2: Fire `search_submit`/`search_result` from `ask()`**

At the top of `ask()` (line 1013, after the empty-text guard): `if (window.gtag) gtag('event', 'search_submit', { canal: window.__canalBusqueda || 'texto' });`. In the success branch (after line 1031's `renderPlan()` call): derive `resultado` as described above and `if (window.gtag) gtag('event', 'search_result', { resultado, canal: window.__canalBusqueda || 'texto', ms: dt });`.

- [ ] **Step 3: Fire `route_view` from `renderPlan()`**

In `renderPlan()` (line 783), in the branch that actually shows a concrete destino (`ru.decision==='directo'||sel`, around line 803): `if (window.gtag) gtag('event', 'route_view', {});`.

- [ ] **Step 4: Manual QA**

With `calle80_tracking_rechazado` unset: perform a search, confirm in the Network tab that `www.googletagmanager.com/gtag/js` loads and a `search_submit`/`search_result` beacon fires to `google-analytics.com`; confirm a `web_vital` event fires for at least one metric after the page settles. With `calle80_tracking_rechazado` set: reload, confirm zero `data-tracking` script tags exist and zero GA4 network calls happen.

- [ ] **Step 5: Commit**

```bash
git add frontend/public/index.html
git commit -m "feat: add GA4 event taxonomy and Core Web Vitals reporting"
```

### Task 7: Sentry, inside `initTracking()`

**Files:**
- Modify: `frontend/public/index.html` (`initTracking()`)

**Interfaces:**
- Consumes: `initTracking()`'s gate from Task 2.
- Produces: client-side error capture via `@sentry/browser`, gated the same as GA4/Clarity.

- [ ] **Step 1: Add the Sentry CDN script and init call inside `initTracking()`**

```js
const SENTRY_DSN = 'https://REEMPLAZAR@oXXXXXX.ingest.us.sentry.io/XXXXXXX'; // público, no secreto
const s3 = document.createElement('script'); s3.src = 'https://browser.sentry-cdn.com/<version>/bundle.min.js'; s3.dataset.tracking = '1';
s3.onload = () => { Sentry.init({ dsn: SENTRY_DSN }); };
document.head.appendChild(s3);
```

`SENTRY_DSN` stays a placeholder until Task 10's manual Sentry-project creation produces a real one — note this as a blocking prerequisite for this step to do anything useful, not something this task's code can create.

- [ ] **Step 2: Manual QA**

With tracking allowed: throw a test error in the console (`throw new Error('qa sentry')`), confirm (once a real DSN is in place) it reaches the Sentry project's Issues list. With tracking rejected: confirm no Sentry script tag is created.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/index.html
git commit -m "feat: add Sentry client error capture, gated by tracking opt-out"
```

### Task 8: Micro-survey UI ("¿te ayudó?")

**Files:**
- Modify: `frontend/public/index.html` (near `renderPlan()`/`ask()`, new small UI element)

**Interfaces:**
- Consumes: the `id` field Task 4 added to `/api/sample`'s response; `POST /api/encuesta` from Task 5.
- Produces: `survey_response {util}` GA4 event (fired alongside the survey POST, inside the same `gtag` guard used elsewhere).

- [ ] **Step 1: Store the current search's id and render the survey after a route shows**

In `ask()`'s success branch, keep `A.lastSearchId = j.id` alongside the existing `A.plan`/`A.ruta` assignments. In `renderPlan()`'s branch that shows a concrete destino (same spot Task 6 fires `route_view`), show a small "¿Esto te ayudó? Sí / No" prompt if `A.lastSearchId` is set and no survey has been sent yet for it.

- [ ] **Step 2: Wire the Sí/No buttons**

```js
function sendSurvey(util){
  if (!A.lastSearchId) return;
  fetch('/api/encuesta', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: A.lastSearchId, util }) }).catch(()=>{});
  if (window.gtag) gtag('event', 'survey_response', { util });
  A.lastSearchId = null; // una sola respuesta por búsqueda
  // ocultar el prompt
}
```

- [ ] **Step 3: Manual QA**

Perform a search that resolves to a route, confirm the survey prompt appears once, click "Sí", confirm `/api/encuesta` fires with the right `id` in the Network tab and the prompt disappears; confirm it does not reappear for the same search.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/index.html
git commit -m "feat: add post-route micro-survey tied to the search id"
```

### Task 9: Docs — `CLAUDE.md`, `README.md`, `EXECUTION.md`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md`

- [ ] **Step 1: `CLAUDE.md` — Commands section**

Add `cd backend && npm install` as a one-time/CI setup command, with the one-line reason: `node --test`'s module resolution walks up from `test/` through `backend/api/` to `backend/node_modules`, which only exists after this install.

- [ ] **Step 2: `CLAUDE.md` — Environment variables section**

Add `POSTGRES_URL` / `DATABASE_URL` to the existing server-only table (same dual-fallback convention as `KV_REST_API_URL`/`UPSTASH_REDIS_REST_URL`). Add a new subsection distinguishing this repo's two categories of frontend-adjacent identifiers now that one exists: **server-only secrets** (the existing table — never reach the browser) vs. **public client-side tracking identifiers** (GA4 Measurement ID, Clarity project ID, Sentry DSN — intentionally hardcoded as named constants in `index.html`'s `initTracking()`, because these vendors are designed to be called directly from the browser and none of the three IDs grant write/delete access to anything).

- [ ] **Step 3: `README.md` — env var table and structure listing**

Add `POSTGRES_URL`/`DATABASE_URL` to the "Variables de entorno" table; add a line for `backend/package.json`, `backend/api/_tracking.js`, `backend/api/encuesta.js`, `backend/sql/001_busquedas.sql` in the structure tree.

- [ ] **Step 4: `EXECUTION.md` — mark completed frentes**

Check off the frentes this plan's Tasks 1-8 close (structured log, Clarity injection point, GA4+CWV, Sentry, banner, micro-survey) and add one dated entry summarizing what shipped, following the file's existing entry format.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-11-15-split-tracking-loadtest-EXECUTION.md
git commit -m "docs: document tracking env vars, public IDs, and backend/package.json setup"
```

### Task 10: Manual/external setup (no code, no automated test)

Follow the precedent of Tasks 4-7 in `docs/superpowers/plans/2026-11-15-split-frontend-backend-trusted-sources.md`: dashboard/account steps tracked as a checklist, not code+test.

- [ ] Create the Neon Postgres project/database; run `backend/sql/001_busquedas.sql` once against it; set `POSTGRES_URL` on the backend Vercel project only (never the frontend project).
- [ ] Create the GA4 property; replace the `GA4_ID` placeholder in `index.html` with the real Measurement ID.
- [ ] Create the Microsoft Clarity project; add its loader snippet inside `initTracking()` (same gated pattern as GA4/Sentry); add its real domain(s) to the CSP if they differ from Task 1's assumption.
- [ ] Create the Sentry project; replace the `SENTRY_DSN` placeholder; confirm the project's actual ingest host is covered by Task 1's CSP `connect-src` (adjust if it isn't).
- [ ] Enable the GA4 → BigQuery Link in GA4 admin (free tier/sandbox).
- [ ] Build the Looker Studio report on top of Postgres (`busquedas` table) + the BigQuery GA4 export — no new code, per the design's no-custom-dashboard non-objective.
- [ ] Route the banner copy (Task 2, Step 2) to the business or a lawyer for Ley 1581 review before relying on it with real beta traffic; update the copy in `index.html` once reviewed.

## Self-Review

**Spec coverage:** structured log (Postgres) → Tasks 3-4; Clarity → Task 2 gate + Task 10 real snippet; GA4+CWV → Task 6; Sentry → Task 7; opt-out banner → Task 2; micro-survey → Tasks 5/8; GA4→BigQuery → Task 10; Looker Studio → Task 10; legal review of banner text → Task 10 (flagged, not performed, per the spec's own "no es algo que este diseño pueda cerrar por su cuenta"). No gaps found.

**Type consistency:** `registrarBusqueda({id, texto, canal, resultado, proveedor, motivoRespaldo, tiempoRespuestaMs, ip})` is the same shape in Task 3's interface and Task 4's call sites. `registrarEncuesta(id, util)` is the same shape in Task 3 and Task 5. `window.__canalBusqueda` is set in Task 4 and read in Task 4/6; `A.lastSearchId` is set in Task 8 and read only in Task 8.

**Proportion:** long, but matches a multi-subsystem front (frontend consent/gating, backend logging, three vendor integrations, external config) — each task is independently shippable, no task is a line-by-line transcript of the whole diff.

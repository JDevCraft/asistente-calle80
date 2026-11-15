# Rate limiting + caché compartido (Upstash Redis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el caché y el rate-limiter en memoria de `api/sample.js`
(los `Map` `CACHE` y `hits`, que no sobreviven al auto-escalado a varias
instancias) por un almacén compartido en Upstash Redis, accedido por su API
REST — sin añadir ninguna dependencia npm nueva.

**Architecture:** Un módulo nuevo (`api/_estado.js`) encapsula el acceso a
Redis vía `fetch` al endpoint `/pipeline` de Upstash (comandos `INCR`,
`EXPIRE`, `GET`, `SET`). `api/sample.js` llama a sus tres funciones en vez de
tocar `Map`s locales. Sin `KV_REST_API_URL`/`KV_REST_API_TOKEN`
configurados, o ante cualquier error de Redis, el módulo se degrada sin
limitar ni cachear — igual que el resto de la app se degrada sin claves de
IA — en vez de romper la petición.

**Tech Stack:** Node.js ≥20, CommonJS, `node:test` nativo, Upstash Redis
(REST API, sin SDK).

**Spec:** `docs/superpowers/specs/2026-11-15-split-tracking-loadtest-design.md`
(secciones "Enfoques considerados → Rate limiting y caché compartido" y
"Decisiones ya tomadas")

## Global Constraints

- Node.js `>=20` (`package.json` `engines.node`).
- CommonJS (`require`/`module.exports`) en todo el repo — sin ESM.
- Cero dependencias npm nuevas (el repo hoy no tiene `dependencies`; este
  plan llama a la API REST de Upstash con `fetch`, no con un SDK).
- Límite de negocio: 20 peticiones / 10 minutos por IP (valor existente en
  `api/sample.js:29`, no cambia).
- TTL de caché: 6 horas (valor existente en `api/sample.js:8`, no cambia).
- `KV_REST_API_URL`/`KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL`/
  `UPSTASH_REDIS_REST_TOKEN`) son server-only — nunca se exponen al
  navegador, igual que `NVIDIA_API_KEY`/`GEMINI_API_KEY`.
- El camino rápido (`rapido()` sin `answers`, `api/sample.js:159-162`) no
  toca caché ni rate limit — debe seguir igual de barato (anti-objetivo del
  diseño).
- `npm test` (`node --test`) debe seguir pasando sin red real — todo
  `fetch` mockeado, incluido el de Redis.

## Review Focus

- Upstash responde con error HTTP (500/401) en una llamada a `/pipeline` →
  `limitado`/`cacheGet`/`cacheSet` deben degradarse (no limitar/no cachear)
  sin lanzar una excepción que rompa la petición.
- Una respuesta de `/pipeline` trae `{"error": ...}` en vez de
  `{"result": ...}` para un comando (Upstash lo permite por comando dentro
  del mismo array 200 OK) → no debe crashear ni tratarse como límite
  alcanzado.
- Un valor corrupto (no-JSON) guardado bajo una clave de caché → `cacheGet`
  debe devolver `null`, no lanzar.
- Dos IPs distintas no deben compartir el mismo contador de rate limit.
- Tras el cambio, `/api/sample` debe seguir devolviendo
  `{"error":"rate_limited"}` con `429` a la petición 21 por la misma IP, y
  `cache:true` en una consulta repetida — el contrato externo no cambia.

---

## File Structure

- Create: `api/_estado.js` — caché y rate-limit compartidos vía Upstash
  Redis (REST). Responsabilidad única: hablar con Redis y degradarse si no
  está disponible.
- Create: `test/estado.test.js` — pruebas de `api/_estado.js` con `fetch`
  simulado (Redis falso en memoria).
- Modify: `api/sample.js:8` (borra `CACHE`/`CACHE_MAX`/`CACHE_MS`),
  `api/sample.js:29-30` (borra `LIMIT`/`WINDOW_MS`/`hits`),
  `api/sample.js:54-60` (borra `limited()`), `api/sample.js:173-175` (caché
  y rate limit ahora async, vía `_estado.js`), `api/sample.js:207-208`
  (escritura de caché vía `_estado.js`).
- Modify: `test/sample.test.js` — añade un Redis falso al router de `fetch`
  ya existente, y las variables de entorno de Upstash, para que los dos
  tests que hoy fijan caché y rate limit sigan pasando sin red real.

### Task 1: `api/_estado.js` — caché y rate-limit en Redis, con degradación

**Files:**
- Create: `api/_estado.js`
- Test: `test/estado.test.js`

**Interfaces:**
- Produces: `limitado(ip: string): Promise<boolean>`,
  `cacheGet(key: string): Promise<any|null>`,
  `cacheSet(key: string, value: any): Promise<void>` — exportados de
  `api/_estado.js`, consumidos por Task 2.

- [ ] **Step 1: Escribir las pruebas de caché (fallan)**

En `test/estado.test.js`:

```js
// Pruebas de api/_estado.js (caché y rate limit compartidos vía Upstash Redis), con fetch simulado.
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'tok-test';
const test = require('node:test'), assert = require('node:assert');

let store;
const reset = () => { store = new Map(); };
global.fetch = async (url, opts) => {
  assert.ok(String(url).endsWith('/pipeline'));
  const cmds = JSON.parse(opts.body);
  const results = cmds.map(([cmd, key, ...args]) => {
    if (cmd === 'INCR') { const v = (store.get(key) || 0) + 1; store.set(key, v); return { result: v }; }
    if (cmd === 'EXPIRE') return { result: store.has(key) ? 1 : 0 };
    if (cmd === 'GET') return { result: store.has(key) ? store.get(key) : null };
    if (cmd === 'SET') { store.set(key, args[0]); return { result: 'OK' }; }
    return { result: null };
  });
  return { ok: true, status: 200, json: async () => results };
};
const estado = require('../api/_estado');

test('cacheGet sin nada guardado → null', async () => {
  reset();
  assert.strictEqual(await estado.cacheGet('x'), null);
});
test('cacheSet luego cacheGet → el mismo valor', async () => {
  reset();
  await estado.cacheSet('x', { a: 1 });
  assert.deepStrictEqual(await estado.cacheGet('x'), { a: 1 });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test test/estado.test.js`
Expected: FAIL con `Cannot find module '../api/_estado'`

- [ ] **Step 3: Implementar `cacheGet`/`cacheSet` en `api/_estado.js`**

```js
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CACHE_TTL_S = 6 * 60 * 60; // 6 h, igual que el CACHE_MS actual de api/sample.js

async function pipeline(cmds) { /* POST a `${BASE}/pipeline`, header authorization: Bearer ${TOKEN}, body JSON.stringify(cmds), devuelve r.json() */ }

async function cacheGet(key) { /* usa pipeline([['GET', `c:${key}`]]); si !BASE o falla, null */ }
async function cacheSet(key, value) { /* usa pipeline([['SET', `c:${key}`, JSON.stringify(value), 'EX', CACHE_TTL_S]]); si !BASE o falla, no-op */ }

module.exports = { cacheGet, cacheSet };
```

Prefija las claves de caché con `c:` para no colisionar con las claves de
rate limit (`rl:`) en el mismo Redis. Envuelve el cuerpo de `cacheGet` y
`cacheSet` en `try/catch`: ante cualquier error (red, JSON inválido),
`cacheGet` devuelve `null` y `cacheSet` no hace nada — nunca relanzan.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test test/estado.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/_estado.js test/estado.test.js
git commit -m "feat: caché compartido en Redis (api/_estado.js)"
```

- [ ] **Step 6: Escribir las pruebas de rate limit (fallan)**

Añadir a `test/estado.test.js`:

```js
test('limitado: 20 llamadas no limitan, la 21 sí', async () => {
  reset();
  let last;
  for (let i = 0; i < 21; i++) last = await estado.limitado('ip-1');
  assert.strictEqual(last, true);
});
test('limitado: IPs distintas no comparten contador', async () => {
  reset();
  for (let i = 0; i < 20; i++) await estado.limitado('ip-a');
  assert.strictEqual(await estado.limitado('ip-b'), false);
});
```

- [ ] **Step 7: Correr y verificar que fallan**

Run: `node --test test/estado.test.js`
Expected: FAIL con `estado.limitado is not a function`

- [ ] **Step 8: Implementar `limitado` en `api/_estado.js`**

```js
const RATE_LIMIT = 20, RATE_WINDOW_S = 600; // 20 peticiones / 10 min por IP, igual que LIMIT/WINDOW_MS actuales

async function limitado(ip) {
  // usa pipeline([['INCR', `rl:${ip}`]]); si count === 1, pipeline([['EXPIRE', `rl:${ip}`, RATE_WINDOW_S]])
  // (la ventana arranca en la primera petición de cada IP, no se reinicia en cada hit)
  // devuelve count > RATE_LIMIT; si !BASE o falla, false
}

module.exports = { limitado, cacheGet, cacheSet };
```

- [ ] **Step 9: Correr y verificar que pasan**

Run: `node --test test/estado.test.js`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add api/_estado.js test/estado.test.js
git commit -m "feat: rate limit compartido en Redis (api/_estado.js)"
```

- [ ] **Step 11: Escribir las pruebas de degradación (fallan)**

Añadir a `test/estado.test.js`:

```js
test('Upstash responde error HTTP → limitado/cacheGet/cacheSet se degradan sin lanzar', async () => {
  reset();
  const prev = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.strictEqual(await estado.limitado('cualquiera'), false);
  assert.strictEqual(await estado.cacheGet('x'), null);
  await assert.doesNotReject(estado.cacheSet('x', { a: 1 }));
  global.fetch = prev;
});
test('un comando del pipeline devuelve {error} en vez de {result} → no crashea', async () => {
  reset();
  const prev = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ error: 'ERR algo' }] });
  assert.strictEqual(await estado.limitado('cualquiera'), false);
  global.fetch = prev;
});
test('valor corrupto (no-JSON) en caché → cacheGet devuelve null', async () => {
  reset();
  store.set('c:x', 'no es json{');
  assert.strictEqual(await estado.cacheGet('x'), null);
});
test('sin KV_REST_API_URL configurado → no limita ni cachea, no lanza', async () => {
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  delete require.cache[require.resolve('../api/_estado')];
  const sinRedis = require('../api/_estado');
  assert.strictEqual(await sinRedis.limitado('cualquiera'), false);
  assert.strictEqual(await sinRedis.cacheGet('x'), null);
  await assert.doesNotReject(sinRedis.cacheSet('x', { a: 1 }));
  process.env.KV_REST_API_URL = 'https://fake-redis.test';
  process.env.KV_REST_API_TOKEN = 'tok-test';
  delete require.cache[require.resolve('../api/_estado')];
});
```

- [ ] **Step 12: Correr y verificar que fallan (o pasan por accidente)**

Run: `node --test test/estado.test.js`
Expected: FAIL si el `try/catch` del Step 3/8 no cubre todavía estos casos
(por ejemplo, si `count` queda `undefined` y `undefined > RATE_LIMIT` no
lanza pero tampoco se probó explícitamente). Si ya pasan, confirma que es
porque el `try/catch` ya es correcto, no porque la prueba esté mal escrita.

- [ ] **Step 13: Ajustar `api/_estado.js` si algún caso falló**

Asegura que el `try/catch` envuelve también la destructuración
`const [{ result }] = ...` (un `{error:...}` sin `result` da
`result === undefined`, que debe tratarse como "sin dato", no lanzar).

- [ ] **Step 14: Correr y verificar que todo pasa**

Run: `node --test test/estado.test.js`
Expected: PASS (8 tests)

- [ ] **Step 15: Commit**

```bash
git add api/_estado.js test/estado.test.js
git commit -m "fix: api/_estado.js se degrada ante errores de Upstash sin romper la petición"
```

### Task 2: integrar `api/_estado.js` en `api/sample.js`

**Files:**
- Modify: `api/sample.js`
- Modify: `test/sample.test.js`

**Interfaces:**
- Consumes: `limitado`, `cacheGet`, `cacheSet` de `api/_estado.js` (Task 1).

- [ ] **Step 1: Extender el `fetch` simulado de `test/sample.test.js` con un Redis falso (prueba que fallará)**

Antes de `const handler = require('../api/sample');`, añadir:

```js
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'tok-test';
```

Dentro de `escenario(s)`, añadir `redisStore = new Map();` a la
inicialización. En el router de `global.fetch`, antes de la rama
`nv`/`gm`/`emb` existente, añadir:

```js
if (u.endsWith('/pipeline')) {
  const cmds = JSON.parse(opts.body);
  const results = cmds.map(([cmd, key, ...args]) => {
    if (cmd === 'INCR') { const v = (redisStore.get(key) || 0) + 1; redisStore.set(key, v); return { result: v }; }
    if (cmd === 'EXPIRE') return { result: redisStore.has(key) ? 1 : 0 };
    if (cmd === 'GET') return { result: redisStore.has(key) ? redisStore.get(key) : null };
    if (cmd === 'SET') { redisStore.set(key, args[0]); return { result: 'OK' }; }
    return { result: null };
  });
  return resp(200, results);
}
```

(`global.fetch` hoy recibe solo `url`; hay que añadirle el segundo
parámetro `opts` para leer `opts.body`.)

No cambia ninguna aserción todavía — este step solo prepara el mock.

- [ ] **Step 2: Correr los tests existentes para confirmar que siguen en verde con el mock nuevo sin usar**

Run: `node --test test/sample.test.js`
Expected: PASS (igual que antes — el mock nuevo no se ejercita hasta el
Step 4)

- [ ] **Step 3: Reemplazar `CACHE`/`hits`/`limited()` por `_estado.js` en `api/sample.js`**

- Borra `api/sample.js:8`
  (`const CACHE = new Map(), CACHE_MAX = 300, CACHE_MS = ...`).
- Borra `api/sample.js:29-30` (`const LIMIT = 20, WINDOW_MS = ...` y
  `const hits = new Map();`).
- Borra la función `limited(ip)` (`api/sample.js:54-60`).
- Añade, junto a los demás `require` (tras `api/sample.js:7`):
  `const { limitado, cacheGet, cacheSet } = require('./_estado');`
- En el handler, reemplaza:
  ```js
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return res.status(200).json({ ...hit.v, cache: true, ms: Date.now() - t0 });
  if (limited(ip)) return respaldo(429, 'rate_limited');
  ```
  por:
  ```js
  const hit = await cacheGet(key);
  if (hit) return res.status(200).json({ ...hit, cache: true, ms: Date.now() - t0 });
  if (await limitado(ip)) return respaldo(429, 'rate_limited');
  ```
- Reemplaza:
  ```js
  CACHE.set(key, { t: Date.now(), v });
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  ```
  por:
  ```js
  await cacheSet(key, v);
  ```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test`
Expected: PASS (todos los tests de `test/sample.test.js` y
`test/estado.test.js`, incluidos los dos que fijan caché y rate limit —
ahora corriendo contra el Redis falso en vez de los `Map` en memoria)

- [ ] **Step 5: Commit**

```bash
git add api/sample.js test/sample.test.js
git commit -m "refactor: api/sample.js usa el caché y rate limit de api/_estado.js (Redis)"
```

---

## Notas para producción (fuera de las pruebas automatizadas)

- Añadir la integración Upstash Redis desde el Marketplace de Vercel al
  proyecto backend, en Production y Preview (la integración define
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` automáticamente).
- Configurar además, solo en el dashboard de Firewall de Vercel, una regla
  de `@vercel/firewall` como protección genérica de borde contra abuso —
  sin que el código ni los tests dependan de ella (ver spec).

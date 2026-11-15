// Pruebas de backend/api/_estado.js (caché y rate limit compartidos vía Upstash Redis), con fetch simulado.
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
const estado = require('../backend/api/_estado');

test('cacheGet sin nada guardado → null', async () => {
  reset();
  assert.strictEqual(await estado.cacheGet('x'), null);
});
test('cacheSet luego cacheGet → el mismo valor', async () => {
  reset();
  await estado.cacheSet('x', { a: 1 });
  assert.deepStrictEqual(await estado.cacheGet('x'), { a: 1 });
});
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
test('Upstash responde error HTTP → limitado/cacheGet/cacheSet se degradan sin lanzar', async () => {
  reset();
  const prev = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.strictEqual(await estado.limitado('cualquiera'), false);
    assert.strictEqual(await estado.cacheGet('x'), null);
    await assert.doesNotReject(estado.cacheSet('x', { a: 1 }));
  } finally { global.fetch = prev; }
});
test('un comando del pipeline devuelve {error} en vez de {result} → no crashea', async () => {
  reset();
  const prev = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => [{ error: 'ERR algo' }] });
    assert.strictEqual(await estado.limitado('cualquiera'), false);
  } finally { global.fetch = prev; }
});
test('valor corrupto (no-JSON) en caché → cacheGet devuelve null', async () => {
  reset();
  store.set('c:x', 'no es json{');
  assert.strictEqual(await estado.cacheGet('x'), null);
});
test('pipeline() pasa un signal de timeout a fetch (para no colgar si Redis no responde)', async () => {
  reset();
  const prev = global.fetch;
  try {
    let seenSignal;
    global.fetch = async (url, opts) => { seenSignal = opts.signal; return { ok: true, status: 200, json: async () => [{ result: null }] }; };
    await estado.cacheGet('x');
    assert.ok(seenSignal instanceof AbortSignal, 'fetch debe recibir un AbortSignal');
  } finally { global.fetch = prev; }
});
test('fetch que rechaza (timeout/abort) → limitado/cacheGet/cacheSet se degradan sin lanzar', async () => {
  reset();
  const prev = global.fetch;
  try {
    global.fetch = async () => { throw new DOMException('timeout', 'AbortError'); };
    assert.strictEqual(await estado.limitado('cualquiera'), false);
    assert.strictEqual(await estado.cacheGet('x'), null);
    await assert.doesNotReject(estado.cacheSet('x', { a: 1 }));
  } finally { global.fetch = prev; }
});
test('limitado: en el primer hit de una IP, manda un solo pipeline (INCR+EXPIRE juntos)', async () => {
  reset();
  const prev = global.fetch;
  try {
    let calls = 0;
    global.fetch = async (url, opts) => { calls++; return prev(url, opts); };
    await estado.limitado('ip-solo-una-llamada');
    assert.strictEqual(calls, 1, 'debe ser un solo round trip, no INCR y EXPIRE por separado');
  } finally { global.fetch = prev; }
});
test('sin KV_REST_API_URL configurado → no limita ni cachea, no lanza', async () => {
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  delete require.cache[require.resolve('../backend/api/_estado')];
  const sinRedis = require('../backend/api/_estado');
  assert.strictEqual(await sinRedis.limitado('cualquiera'), false);
  assert.strictEqual(await sinRedis.cacheGet('x'), null);
  await assert.doesNotReject(sinRedis.cacheSet('x', { a: 1 }));
  process.env.KV_REST_API_URL = 'https://fake-redis.test';
  process.env.KV_REST_API_TOKEN = 'tok-test';
  delete require.cache[require.resolve('../backend/api/_estado')];
});

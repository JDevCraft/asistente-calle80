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

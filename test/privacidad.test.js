// Privacidad del registro: retención (purga de 30 días), endpoint de cron protegido y claves de Redis
// sin texto ni IP en claro. Igual que tracking.test.js: fetch simulado, sin red.
process.env.POSTGRES_URL = 'postgresql://u:p@fake-neon.test/db';
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 't';
process.env.HASH_SALT = 'sal-de-prueba';
process.env.CRON_SECRET = 'secreto-cron';
delete process.env.DATABASE_URL;
const test = require('node:test'), assert = require('node:assert');

console.error = () => {};

let llamadas;
let filasBorradas = 3;
const respuesta = url => {
  if (String(url).endsWith('/sql')) return { ok: true, status: 200, json: async () => ({ fields: [], rows: [], command: 'DELETE', rowCount: filasBorradas }), text: async () => '' };
  return { ok: true, status: 200, json: async () => [{ result: null }], text: async () => '' };
};
global.fetch = async (url, opts) => { llamadas.push({ url: String(url), opts }); return respuesta(url); };
const reset = () => { llamadas = []; };

const { purgarBusquedas } = require('../backend/api/_tracking');
const purgar = require('../backend/api/purgar');
const estado = require('../backend/api/_estado');

function res() {
  const r = { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return r;
}

test('purgarBusquedas: DELETE parametrizado con retención de 30 días y devuelve filas borradas', async () => {
  reset();
  const n = await purgarBusquedas(30);
  const body = JSON.parse(llamadas[0].opts.body);
  assert.match(body.query, /DELETE FROM busquedas/);
  assert.match(body.query, /creado_en < now\(\)/);
  assert.deepStrictEqual(body.params, ['30']);
  assert.strictEqual(n, 3);
});

test('endpoint /api/purgar sin Authorization correcto → 401 y no borra nada', async () => {
  reset();
  const r = res();
  await purgar({ method: 'GET', headers: {} }, r);
  assert.strictEqual(r.code, 401);
  assert.strictEqual(llamadas.length, 0);
});

test('endpoint /api/purgar con Bearer correcto → 200 con conteo', async () => {
  reset();
  const r = res();
  await purgar({ method: 'GET', headers: { authorization: 'Bearer secreto-cron' } }, r);
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, { borradas: 3 });
});

test('límite de tasa: la clave en Redis es un hash, sin IP en claro', async () => {
  reset();
  await estado.limitado('203.0.113.7');
  const cmds = JSON.parse(llamadas[0].opts.body);
  const clave = cmds[0][1];
  assert.match(clave, /^rl:[0-9a-f]{64}$/);
  assert.ok(!clave.includes('203.0.113.7'));
});

test('caché: la clave no contiene el texto de la búsqueda', async () => {
  reset();
  await estado.cacheSet('pintura para baño', { ruta: {} });
  const cmds = JSON.parse(llamadas[0].opts.body);
  assert.match(cmds[0][1], /^c:[0-9a-f]{64}$/);
  assert.ok(!cmds[0][1].includes('pintura'));
});

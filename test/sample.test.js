// Pruebas del handler de /api/sample con fetch simulado: fijan el comportamiento de la cadena
// NVIDIA → Gemini → respaldo, la caché y el límite por IP, para poder reorganizar el handler sin cambiarlo.
process.env.NVIDIA_API_KEY = 'nv-test';
process.env.GEMINI_API_KEY = 'gm-test';
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'tok-test';
delete process.env.NVIDIA_MODEL; delete process.env.GEMINI_MODEL;
const test = require('node:test'), assert = require('node:assert');
const handler = require('../backend/api/sample');

console.error = () => {}; // el handler registra los fallos esperados
const PLAN = JSON.stringify({ necesidad: 'impermeabilizar', grupos: [{ rol: 'Principal', segmentos: [100] }], preguntas: [], consejo: '' });
const resp = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const nvOk = () => resp(200, { choices: [{ message: { content: PLAN } }] });
const gmOk = () => resp(200, { candidates: [{ content: { parts: [{ text: PLAN }] } }] });

let sc, llamadas, redisStore;
global.fetch = async (url, opts) => {
  const u = String(url);
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
  const k = u.includes('/embeddings') ? 'emb' : u.includes('nvidia.com') ? 'nv' : 'gm';
  llamadas[k]++;
  return sc[k]();
};
const run = async (text, { ip = 'ip-' + text, method = 'POST', answers } = {}) => {
  const res = { h: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, headers: { 'x-forwarded-for': ip }, body: { text, answers } }, res);
  return res;
};
const escenario = s => { sc = { emb: () => resp(500, {}), nv: nvOk, gm: gmOk, ...s }; llamadas = { emb: 0, nv: 0, gm: 0 }; redisStore = new Map(); };
// consultas abiertas que el índice no entiende, para que lleguen al modelo
const Q = n => 'zzqx qwv ' + n;

test('método distinto de POST → 405; texto vacío → 400', async () => {
  escenario({});
  assert.strictEqual((await run('x', { method: 'GET' })).code, 405);
  assert.strictEqual((await run('')).code, 400);
});
test('NVIDIA responde → plan y no se llama a Gemini', async () => {
  escenario({});
  const r = await run(Q(1));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.plan.necesidad, 'impermeabilizar');
  assert.strictEqual(r.body.catalogo, 'completo'); // el recorte falló (embeddings 500) → catálogo completo
  assert.deepStrictEqual([llamadas.nv, llamadas.gm], [1, 0]);
});
test('NVIDIA falla en los dos modelos → Gemini responde', async () => {
  escenario({ nv: () => resp(500, {}) });
  const r = await run(Q(2));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.plan.necesidad, 'impermeabilizar');
  assert.deepStrictEqual([llamadas.nv, llamadas.gm], [2, 1]);
});
test('NVIDIA devuelve JSON inválido → Gemini responde', async () => {
  escenario({ nv: () => resp(200, { choices: [{ message: { content: 'no es json' } }] }) });
  const r = await run(Q(3));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.plan.necesidad, 'impermeabilizar');
});
test('ninguna IA responde (503) → 503 ia_ocupada', async () => {
  escenario({ nv: () => resp(503, {}), gm: () => resp(503, {}) });
  const r = await run(Q(4));
  assert.strictEqual(r.code, 503);
  assert.strictEqual(r.body.error, 'ia_ocupada');
});
test('error no recuperable de ambos → 502 error', async () => {
  escenario({ nv: () => resp(500, {}), gm: () => resp(400, {}) });
  const r = await run(Q(5));
  assert.strictEqual(r.code, 502);
  assert.strictEqual(r.body.error, 'error');
});
test('Gemini bloquea la respuesta → sin índice que sirva, error refused', async () => {
  escenario({ nv: () => resp(500, {}), gm: () => resp(200, { promptFeedback: { blockReason: 'SAFETY' } }) });
  const r = await run(Q(6));
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.error, 'refused');
});
test('misma consulta dos veces → la segunda sale de la caché', async () => {
  escenario({});
  await run(Q(7), { ip: 'a' });
  const n = llamadas.nv;
  const r = await run(Q(7), { ip: 'b' });
  assert.strictEqual(r.body.cache, true);
  assert.strictEqual(llamadas.nv, n);
});
test('más de 20 consultas por IP → 429 rate_limited', async () => {
  escenario({});
  let r;
  for (let i = 0; i < 21; i++) r = await run(Q('rl' + i), { ip: 'misma' });
  assert.strictEqual(r.code, 429);
  assert.strictEqual(r.body.error, 'rate_limited');
});

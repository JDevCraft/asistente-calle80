// Pruebas del handler de /api/sample con fetch simulado: fijan el comportamiento de la cadena
// NVIDIA → Gemini → respaldo, la caché y el límite por IP, para poder reorganizar el handler sin cambiarlo.
process.env.NVIDIA_API_KEY = 'nv-test';
process.env.GEMINI_API_KEY = 'gm-test';
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'tok-test';
// Registro de búsquedas (_tracking.js real): el driver de Neon hace POST a https://api.<dominio>/sql con {query, params}
// y la cadena de conexión en la cabecera Neon-Connection-String (por eso el mock la reconoce por esa cabecera)
process.env.POSTGRES_URL = 'postgresql://u:p@fake-neon.test/db';
delete process.env.DATABASE_URL;
delete process.env.NVIDIA_MODEL; delete process.env.GEMINI_MODEL;
const test = require('node:test'), assert = require('node:assert');
const handler = require('../backend/api/sample');

console.error = () => {}; // el handler registra los fallos esperados
const PLAN = JSON.stringify({ necesidad: 'impermeabilizar', grupos: [{ rol: 'Principal', segmentos: [100] }], preguntas: [], consejo: '' });
const resp = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const nvOk = () => resp(200, { choices: [{ message: { content: PLAN } }] });
const gmOk = () => resp(200, { candidates: [{ content: { parts: [{ text: PLAN }] } }] });

let sc, llamadas, redisStore, registros;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (opts && opts.headers && opts.headers['Neon-Connection-String']) {
    registros.push(JSON.parse(opts.body));
    return resp(200, { fields: [], rows: [], command: 'INSERT', rowCount: 1 });
  }
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
const run = async (text, { ip = 'ip-' + text, method = 'POST', answers, canal, rechazado } = {}) => {
  const res = { h: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); return this; } }; // como en el cable: undefined desaparece
  await handler({ method, headers: { 'x-forwarded-for': ip }, body: { text, answers, canal, rechazado } }, res);
  return res;
};
const escenario = s => { sc = { emb: () => resp(500, {}), nv: nvOk, gm: gmOk, ...s }; llamadas = { emb: 0, nv: 0, gm: 0 }; redisStore = new Map(); registros = []; };
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

// --- Registro estructurado (Task 4). Los params son posicionales, en el orden del INSERT de _tracking.js:
// [id, texto, canal, resultado, proveedor, motivo_respaldo, tiempo_respuesta_ms, ip]
const reg = q => { const [id, texto, canal, resultado, proveedor, motivoRespaldo, ms, ip] = q.params; return { id, texto, canal, resultado, proveedor, motivoRespaldo, ms, ip }; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "pintura" la entiende el índice (camino rápido); 'zzqx qwv' no, ni siquiera en modo laxo
const IDX = 'pintura';

test('canal por defecto es texto si no se manda', async () => {
  escenario({});
  await run(Q('c1'));
  assert.strictEqual(registros.length, 1);
  assert.match(registros[0].query, /INSERT INTO busquedas/);
  assert.strictEqual(reg(registros[0]).canal, 'texto');
});
test('canal "voz" se propaga al registro; un valor desconocido cae a texto', async () => {
  escenario({});
  await run(Q('c2'), { canal: 'voz' });
  assert.strictEqual(reg(registros[0]).canal, 'voz');
  escenario({});
  await run(Q('c3'), { canal: 'hackeo' });
  assert.strictEqual(reg(registros[0]).canal, 'texto');
});
test('respuesta exitosa incluye "id" (UUID) igual al del registro, con texto, ip y tiempo', async () => {
  escenario({});
  const r = await run(Q('c4'), { ip: '9.9.9.9' });
  assert.strictEqual(r.code, 200);
  assert.match(r.body.id, UUID);
  const g = reg(registros[0]);
  assert.strictEqual(g.id, r.body.id);
  assert.strictEqual(g.texto, Q('c4'));
  assert.strictEqual(g.ip, '9.9.9.9');
  assert.strictEqual(g.resultado, 'modelo');
  assert.strictEqual(g.motivoRespaldo, null);
  assert.ok(Number(g.ms) >= 0);
});
test('proveedor queda "nvidia" cuando NVIDIA responde, "gemini" cuando NVIDIA falla y Gemini responde', async () => {
  escenario({});
  await run(Q('p1'));
  assert.strictEqual(reg(registros[0]).proveedor, 'nvidia');
  escenario({ nv: () => resp(500, {}) });
  await run(Q('p2'));
  assert.strictEqual(registros.length, 1);
  assert.strictEqual(reg(registros[0]).proveedor, 'gemini');
});
test('camino rápido (índice, sin IA) → resultado "indice", sin proveedor, con id', async () => {
  escenario({});
  const r = await run(IDX);
  assert.strictEqual(r.code, 200);
  assert.ok(r.body.ruta);
  assert.deepStrictEqual([llamadas.nv, llamadas.gm], [0, 0]);
  assert.strictEqual(registros.length, 1);
  const g = reg(registros[0]);
  assert.strictEqual(g.resultado, 'indice');
  assert.strictEqual(g.proveedor, null);
  assert.strictEqual(g.id, r.body.id);
  assert.match(r.body.id, UUID);
});
test('respaldo con índice laxo → resultado "respaldo" con motivo; sin índice → "error" sin id en la respuesta', async () => {
  // 'pintura zzqx qwv' no la entiende el índice estricto (llega al modelo), pero el laxo sí encuentra "pintura"
  escenario({ nv: () => resp(503, {}), gm: () => resp(503, {}) });
  const r1 = await run(IDX + ' zzqx qwv');
  assert.strictEqual(r1.code, 200);
  assert.strictEqual(r1.body.ruta.respaldo, true);
  let g = reg(registros[0]);
  assert.strictEqual(g.resultado, 'respaldo');
  assert.strictEqual(g.motivoRespaldo, 'ia_ocupada');
  assert.strictEqual(g.id, r1.body.id);

  escenario({ nv: () => resp(503, {}), gm: () => resp(503, {}) });
  const r2 = await run(Q('e1'));
  assert.strictEqual(r2.code, 503);
  assert.strictEqual(r2.body.id, undefined);
  g = reg(registros[0]);
  assert.strictEqual(g.resultado, 'error');
  assert.strictEqual(g.motivoRespaldo, 'ia_ocupada');
  assert.strictEqual(g.proveedor, null);
});
test('caché → resultado "modelo", proveedor null y un id nuevo', async () => {
  escenario({});
  const a = await run(Q('k1'), { ip: 'a' });
  const b = await run(Q('k1'), { ip: 'b' });
  assert.strictEqual(b.body.cache, true);
  assert.strictEqual(registros.length, 2);
  const g = reg(registros[1]);
  assert.strictEqual(g.resultado, 'modelo');
  assert.strictEqual(g.proveedor, null);
  assert.match(b.body.id, UUID);
  assert.notStrictEqual(b.body.id, a.body.id);
  assert.strictEqual(g.id, b.body.id);
});
test('rechazado:true suprime el registro en todos los caminos pero no cambia la respuesta al cliente', async () => {
  // éxito con modelo
  escenario({});
  let r = await run(Q('r1'), { rechazado: true });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.plan.necesidad, 'impermeabilizar');
  assert.ok(!('id' in r.body));
  assert.strictEqual(registros.length, 0, 'éxito con modelo no debe registrar');
  // caché
  r = await run(Q('r1'), { rechazado: true, ip: 'otra' });
  assert.strictEqual(r.body.cache, true);
  assert.ok(!('id' in r.body));
  assert.strictEqual(registros.length, 0, 'acierto de caché no debe registrar');
  // camino rápido
  r = await run(IDX, { rechazado: true });
  assert.strictEqual(r.code, 200);
  assert.ok(!('id' in r.body));
  assert.strictEqual(registros.length, 0, 'camino rápido no debe registrar');
  // respaldo laxo y error
  escenario({ nv: () => resp(503, {}), gm: () => resp(503, {}) });
  r = await run(IDX + ' zzqx qwv', { rechazado: true });
  assert.strictEqual(r.body.ruta.respaldo, true);
  assert.ok(!('id' in r.body));
  assert.strictEqual(registros.length, 0, 'respaldo laxo no debe registrar');
  r = await run(Q('r2'), { rechazado: true });
  assert.strictEqual(r.code, 503);
  assert.strictEqual(registros.length, 0, 'error 503 no debe registrar');
  // rate limit
  escenario({});
  for (let i = 0; i < 21; i++) r = await run(Q('rr' + i), { ip: 'misma-r', rechazado: true });
  assert.strictEqual(r.code, 429);
  assert.strictEqual(registros.length, 0, 'éxitos con modelo y rate_limited no deben registrar');
  // control: la misma consulta sin rechazado sí se registra (la prueba no pasa solo porque nada registra)
  r = await run(IDX);
  assert.strictEqual(registros.length, 1);
  assert.match(r.body.id, UUID);
});
test('400 y 405 no se registran', async () => {
  escenario({});
  await run('x', { method: 'GET' });
  await run('');
  assert.strictEqual(registros.length, 0);
});

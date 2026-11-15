// Pruebas del handler de /api/encuesta con el _tracking.js real y fetch simulado: el driver de Neon hace
// POST con {query, params} y la cadena de conexión en la cabecera Neon-Connection-String.
process.env.POSTGRES_URL = 'postgresql://u:p@fake-neon.test/db';
delete process.env.DATABASE_URL;
const test = require('node:test'), assert = require('node:assert');
const handler = require('../backend/api/encuesta');

console.error = () => {}; // el módulo de registro informa los fallos esperados (fail-open)
const ID = '3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f';
let neon, modo;
global.fetch = async (url, opts) => {
  if (opts && opts.headers && opts.headers['Neon-Connection-String']) {
    neon.push(JSON.parse(opts.body));
    if (modo === 'rechaza') throw new Error('red caída');
    if (modo === '500') return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
    return { ok: true, status: 200, json: async () => ({ fields: [], rows: [], command: 'UPDATE', rowCount: 1 }), text: async () => '' };
  }
  throw new Error('fetch inesperado: ' + url);
};
const run = async (body, { method = 'POST', m = 'ok' } = {}) => {
  neon = []; modo = m;
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = JSON.parse(JSON.stringify(b)); return this; } };
  await handler({ method, headers: {}, body }, res);
  return res;
};

test('método distinto de POST → 405', async () => {
  const r = await run({ id: ID, util: true }, { method: 'GET' });
  assert.strictEqual(r.code, 405);
  assert.deepStrictEqual(r.body, { error: 'method' });
  assert.strictEqual(neon.length, 0);
});
test('{id, util:true} → 200 {} y un UPDATE con [true, id]', async () => {
  const r = await run({ id: ID, util: true });
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(r.body, {});
  assert.strictEqual(neon.length, 1);
  assert.match(neon[0].query, /UPDATE busquedas SET util = \$1 WHERE id = \$2/);
  assert.deepStrictEqual(neon[0].params, ['true', ID]); // el driver serializa booleanos como string
});
test('{id, util:false} → 200 {} y un UPDATE con [false, id]', async () => {
  const r = await run({ id: ID, util: false });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(neon.length, 1);
  assert.deepStrictEqual(neon[0].params, ['false', ID]);
});
test('util no booleano ("false") o ausente → 200 {} sin consultar Neon', async () => {
  for (const body of [{ id: ID, util: 'false' }, { id: ID }, { id: ID, util: 1 }, { util: true }, {}, null]) {
    const r = await run(body);
    assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(r.body, {});
    assert.strictEqual(neon.length, 0, JSON.stringify(body));
  }
});
test('Neon rechaza o responde 500 → igual 200 {}', async () => {
  for (const m of ['rechaza', '500']) {
    const r = await run({ id: ID, util: true }, { m });
    assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(r.body, {});
    assert.strictEqual(neon.length, 1);
  }
});
test('cuerpo como texto JSON se interpreta igual; texto inválido → 200 sin consulta', async () => {
  const r = await run(JSON.stringify({ id: ID, util: false }));
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(neon[0].params, ['false', ID]);
  const r2 = await run('{no es json');
  assert.strictEqual(r2.code, 200);
  assert.strictEqual(neon.length, 0);
});

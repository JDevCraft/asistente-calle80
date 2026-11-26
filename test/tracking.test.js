// Pruebas de backend/api/_tracking.js (registro estructurado de búsquedas en Postgres vía el driver
// HTTP de Neon), con fetch simulado. El driver llama a `fetch` global en cada consulta (POST con body
// JSON {query, params} y la cadena de conexión en la cabecera Neon-Connection-String), así que basta
// con reemplazar global.fetch.
process.env.POSTGRES_URL = 'postgresql://u:p@fake-neon.test/db';
delete process.env.DATABASE_URL;
const test = require('node:test'), assert = require('node:assert');

console.error = () => {}; // el módulo registra los fallos esperados (fail-open)

let llamadas;
const ok = () => ({ ok: true, status: 200, json: async () => ({ fields: [], rows: [] }), text: async () => '' });
global.fetch = async (url, opts) => { llamadas.push({ url: String(url), opts }); return ok(); };
const reset = () => { llamadas = []; };
const { registrarBusqueda, registrarEncuesta, registrarMotivo } = require('../backend/api/_tracking');

const ID = '3f1c2a4e-8b7d-4c6a-9e5f-1a2b3c4d5e6f';
const SES = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DATOS = {
  id: ID, texto: 'pintura para baño', canal: 'texto', resultado: 'modelo', proveedor: 'nvidia',
  motivoRespaldo: null, tiempoRespuestaMs: 1234, sesionId: SES, ip: '1.2.3.4'
};

test('registrarBusqueda feliz: un INSERT parametrizado con los campos dados', async () => {
  reset();
  await registrarBusqueda(DATOS);
  assert.strictEqual(llamadas.length, 1);
  const { url, opts } = llamadas[0];
  assert.ok(url.endsWith('/sql'), `url inesperada: ${url}`);
  assert.strictEqual(opts.method, 'POST');
  // El driver añade ?application_name=... a la cadena de conexión.
  assert.ok(opts.headers['Neon-Connection-String'].startsWith(process.env.POSTGRES_URL));
  assert.ok(opts.signal instanceof AbortSignal, 'fetch debe recibir un AbortSignal de timeout');
  const body = JSON.parse(opts.body);
  assert.match(body.query, /INSERT INTO busquedas/);
  assert.match(body.query, /motivo_respaldo/);
  assert.match(body.query, /tiempo_respuesta_ms/);
  assert.ok(!body.query.includes('pintura'), 'el texto no debe interpolarse en el SQL');
  // El driver serializa los valores con prepareValue de pg: números → string, null → null.
  assert.match(body.query, /sesion_id/);
  assert.deepStrictEqual(body.params, [ID, 'pintura para baño', 'texto', 'modelo', 'nvidia', null, '1234', SES]);
  assert.ok(!/\bip\b/.test(body.query), 'el INSERT no debe incluir la columna ip (privacidad)');
});

test('registrarBusqueda: campos opcionales ausentes → NULL', async () => {
  reset();
  await registrarBusqueda({ id: ID, texto: 'x', canal: 'voz', resultado: 'error' });
  const body = JSON.parse(llamadas[0].opts.body);
  assert.deepStrictEqual(body.params, [ID, 'x', 'voz', 'error', null, null, null, null]);
});

test('registrarEncuesta feliz: un UPDATE parametrizado con [util, id]', async () => {
  reset();
  await registrarEncuesta(ID, true);
  assert.strictEqual(llamadas.length, 1);
  const body = JSON.parse(llamadas[0].opts.body);
  assert.match(body.query, /UPDATE busquedas SET util = \$1 WHERE id = \$2/);
  assert.deepStrictEqual(body.params, ['true', ID]);
  assert.ok(llamadas[0].opts.signal instanceof AbortSignal);
});

test('registrarEncuesta con id no-UUID no lanza ni consulta', async () => {
  reset();
  await assert.doesNotReject(registrarEncuesta('no-es-uuid', false));
  await assert.doesNotReject(registrarEncuesta(undefined, false));
  assert.strictEqual(llamadas.length, 0);
});

test('registrarBusqueda con fetch que falla no lanza (fail-open)', async () => {
  const prev = global.fetch;
  try {
    global.fetch = async () => { throw new DOMException('timeout', 'AbortError'); };
    await assert.doesNotReject(registrarBusqueda(DATOS));
  } finally { global.fetch = prev; }
});

test('registrarEncuesta con fetch que falla no lanza (fail-open)', async () => {
  const prev = global.fetch;
  try {
    global.fetch = async () => { throw new Error('red caída'); };
    await assert.doesNotReject(registrarEncuesta(ID, true));
  } finally { global.fetch = prev; }
});

test('Postgres responde error HTTP → no lanza', async () => {
  const prev = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' });
    await assert.doesNotReject(registrarBusqueda(DATOS));
    await assert.doesNotReject(registrarEncuesta(ID, false));
  } finally { global.fetch = prev; }
});

test('sin POSTGRES_URL/DATABASE_URL configurado → no consulta, no lanza', async () => {
  delete process.env.POSTGRES_URL; delete process.env.DATABASE_URL;
  delete require.cache[require.resolve('../backend/api/_tracking')];
  try {
    const sinDb = require('../backend/api/_tracking');
    reset();
    await assert.doesNotReject(sinDb.registrarBusqueda(DATOS));
    await assert.doesNotReject(sinDb.registrarEncuesta(ID, true));
    assert.strictEqual(llamadas.length, 0, 'sin cadena de conexión no debe haber fetch');
  } finally {
    process.env.POSTGRES_URL = 'postgresql://u:p@fake-neon.test/db';
    delete require.cache[require.resolve('../backend/api/_tracking')];
  }
});

test('DATABASE_URL sirve de respaldo cuando falta POSTGRES_URL', async () => {
  delete process.env.POSTGRES_URL;
  process.env.DATABASE_URL = 'postgresql://u:p@fake-neon-db.test/db';
  delete require.cache[require.resolve('../backend/api/_tracking')];
  try {
    const conDb = require('../backend/api/_tracking');
    reset();
    await conDb.registrarEncuesta(ID, false);
    assert.strictEqual(llamadas.length, 1);
    assert.ok(llamadas[0].opts.headers['Neon-Connection-String'].startsWith(process.env.DATABASE_URL));
  } finally {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = 'postgresql://u:p@fake-neon.test/db';
    delete require.cache[require.resolve('../backend/api/_tracking')];
  }
});

test('registrarBusqueda: sesionId que no es UUID se guarda como NULL', async () => {
  reset();
  await registrarBusqueda({ id: ID, texto: 'x', canal: 'texto', resultado: 'indice', sesionId: 'no-es-uuid' });
  assert.strictEqual(JSON.parse(llamadas[0].opts.body).params[7], null);
});

test('registrarMotivo feliz: UPDATE parametrizado solo sobre filas con util = false y sin motivo', async () => {
  reset();
  await registrarMotivo(ID, 'otro', '  no había el modelo  ');
  assert.strictEqual(llamadas.length, 1);
  const body = JSON.parse(llamadas[0].opts.body);
  assert.match(body.query, /UPDATE busquedas SET motivo = \$1, comentario = \$2 WHERE id = \$3 AND util = false AND motivo IS NULL/);
  assert.deepStrictEqual(body.params, ['otro', 'no había el modelo', ID]);
});

test('registrarMotivo: comentario se recorta a 140 y vacío → NULL', async () => {
  reset();
  await registrarMotivo(ID, 'otro', 'x'.repeat(300));
  assert.strictEqual(JSON.parse(llamadas[0].opts.body).params[1].length, 140);
  reset();
  await registrarMotivo(ID, 'no_era', '   ');
  assert.strictEqual(JSON.parse(llamadas[0].opts.body).params[1], null);
});

test('registrarMotivo: motivo fuera de la lista o id no-UUID → no consulta ni lanza', async () => {
  reset();
  await assert.doesNotReject(registrarMotivo(ID, 'hackeo', 'x'));
  await assert.doesNotReject(registrarMotivo('no-es-uuid', 'otro', 'x'));
  assert.strictEqual(llamadas.length, 0);
});

test('registrarBusqueda con consejo: se guarda recortado a 300 caracteres', async () => {
  reset();
  await registrarBusqueda({ ...DATOS, consejo: '  ' + 'x'.repeat(400) });
  const body = JSON.parse(llamadas[0].opts.body);
  assert.match(body.query, /, consejo\) VALUES .*\$9\)/);
  assert.strictEqual(body.params[8].length, 300);
});

test('registrarBusqueda: si la columna consejo no existe aún, la búsqueda se guarda sin ella', async () => {
  reset();
  const antes = global.fetch;
  global.fetch = async (url, opts) => { llamadas.push({ url: String(url), opts }); return JSON.parse(opts.body).query.includes('consejo')
    ? { ok: false, status: 400, json: async () => ({ message: 'column "consejo" does not exist' }), text: async () => 'column "consejo" does not exist' } : ok(); };
  try { await registrarBusqueda({ ...DATOS, consejo: 'Pregunta a un asesor.' }); } finally { global.fetch = antes; }
  assert.strictEqual(llamadas.length, 2);
  assert.ok(!JSON.parse(llamadas[1].opts.body).query.includes('consejo'));
});

test('registrarBusqueda con columnas de analítica: solo viajan las válidas', async () => {
  reset();
  await registrarBusqueda({ ...DATOS, destino: '14C–17C', decision: 'directo', cache: false, nRespuestas: 0, plataforma: 'ios', version: '117', alcance: 'inventado' });
  const body = JSON.parse(llamadas[0].opts.body);
  assert.match(body.query, /, destino, decision, cache, n_respuestas, plataforma, version\) VALUES/);
  assert.ok(!body.query.includes('alcance'), 'un alcance fuera de la lista no se guarda');
  assert.deepStrictEqual(body.params.slice(8), ['14C–17C', 'directo', 'false', '0', 'ios', '117']);
});

const { registrarEventos } = require('../backend/api/_tracking');

test('registrarEventos: un INSERT con todas las filas válidas; descarta tipo desconocido y limpia el detalle', async () => {
  reset();
  await registrarEventos(SES, [
    { t: 'ver_pasillos', d: 'on', b: ID }, { t: 'borrar_todo', d: 'x' }, { t: 'voz_error', d: '<b>not-allowed</b>' }, { t: 'pago_click' }
  ], 'android', '117');
  assert.strictEqual(llamadas.length, 1);
  const body = JSON.parse(llamadas[0].opts.body);
  assert.match(body.query, /INSERT INTO eventos/);
  assert.strictEqual(body.params.length, 18); // 3 filas válidas × 6 columnas
  assert.deepStrictEqual(body.params.slice(0, 6), [SES, ID, 'ver_pasillos', 'on', 'android', '117']);
  assert.strictEqual(body.params[9], 'bnot-allowedb'); // sin < > /
  assert.strictEqual(body.params[13], null); // sin b → sin búsqueda
});

test('registrarEventos: sin sesión válida, sin eventos o más de 10 → nada o recortado', async () => {
  reset();
  await registrarEventos('no-uuid', [{ t: 'ver_pasillos' }], 'ios', '1');
  await registrarEventos(SES, [], 'ios', '1');
  await registrarEventos(SES, 'x', 'ios', '1');
  assert.strictEqual(llamadas.length, 0);
  await registrarEventos(SES, Array.from({ length: 25 }, () => ({ t: 'paso_manual', d: '1' })), 'ios', '1');
  assert.strictEqual(JSON.parse(llamadas[0].opts.body).params.length, 60); // 10 × 6
});

test('/api/evento: POST registra y responde 200 {}; otro método → 405', async () => {
  reset();
  const handler = require('../backend/api/evento');
  const r = () => ({ status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} });
  const res = r();
  await handler({ method: 'POST', headers: {}, body: JSON.stringify({ sesionId: SES, plataforma: 'ios', version: '117', eventos: [{ t: 'pago_click' }] }) }, res);
  assert.strictEqual(res.code, 200); assert.deepStrictEqual(res.body, {}); assert.strictEqual(llamadas.length, 1);
  const g = r(); await handler({ method: 'GET', headers: {} }, g); assert.strictEqual(g.code, 405);
  const m = r(); await handler({ method: 'POST', headers: {}, body: 'no es json' }, m); assert.strictEqual(m.code, 200); // inválido: fail-open
});

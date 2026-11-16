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

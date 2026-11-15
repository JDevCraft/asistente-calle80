// Red de seguridad del motor de destinos: fija decisión y destinos de consultas conocidas.
// Si cambia un umbral o el índice (scripts/build_destinos.py), estos casos avisan; actualizar solo si el cambio es intencional.
const test = require('node:test'), assert = require('node:assert');
const { rapido, tokens } = require('../backend/api/_engine');

const resumen = q => { const r = rapido(q); return r && { decision: r.decision, rangos: r.destinos.map(d => d.rango) }; };

test('tipo con varios usos → preguntar', () => {
  assert.deepStrictEqual(resumen('tapete'), { decision: 'preguntar', rangos: ['19A–22A', '31A', '11C–12C', '07A–08A'] });
  assert.deepStrictEqual(resumen('sellador').decision, 'preguntar');
});
test('tipo + uso → directo', () => {
  assert.deepStrictEqual(resumen('tapete para baño'), { decision: 'directo', rangos: ['31A'] });
  assert.strictEqual(resumen('taladro').decision, 'directo');
});
test('consulta que el índice no entiende → null (pasa al modelo)', () => {
  assert.strictEqual(rapido('xyzzy'), null);
  assert.strictEqual(rapido('pintura con plomo'), null);
});
test('modo laxo ignora palabras desconocidas', () => {
  assert.strictEqual(rapido('jarra de jugo', { laxo: true }).decision !== undefined, true);
});
test('clave de caché distingue con/sin', () => {
  assert.notStrictEqual(tokens('pintura con plomo').join(' '), tokens('pintura sin plomo').join(' '));
});

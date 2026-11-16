'use strict';
// Prueba el motor de ruta (bundle frontend/public/js/ruta.js) en Node con un DOM de mentira.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function el() {
  const target = function () {};
  const p = new Proxy(target, {
    get(_, k) {
      if (k === 'getTotalLength') return () => 100;
      if (k === 'style') return {};
      if (k === 'classList') return { add() {}, remove() {}, toggle() {} };
      if (k === 'querySelector') return () => null;
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getAttribute') return () => null;
      if (k === 'length') return 0;
      if (k === Symbol.iterator) return function* () {};
      return p;
    },
    set() { return true; },
    apply() { return p; },
  });
  return p;
}

function cargarMotor() {
  const doc = el();
  const win = {};
  const ctx = {
    window: win, document: doc, matchMedia: () => ({ matches: true }),
    Option: function () { return el(); }, performance: { now: () => 0 },
    requestAnimationFrame: () => 0, atob, btoa, Math, console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'js', 'ruta.js'), 'utf8');
  vm.runInContext(src, ctx);
  return win;
}

const motor = cargarMotor();
const ids = motor.pasillosDelPlano();

test('el plano expone pasillos', () => {
  assert.ok(ids.length > 5);
});

test('ruta desde la entrada sigue empezando con "Desde la entrada"', () => {
  const r = motor.calcularRuta(ids[0]);
  assert.ok(r.instrucciones.length > 0);
  assert.match(r.instrucciones[0], /^Desde la entrada,/);
});

test('ruta desde un pasillo genera instrucciones giro por giro', () => {
  const origen = ids[0];
  let probados = 0;
  for (const destino of ids) {
    if (destino === origen) continue;
    const r = motor.calcularRuta(destino, { desde: origen });
    probados++;
    assert.ok(r.instrucciones.length >= 1, `sin instrucciones ${origen} -> ${destino}`);
    assert.match(r.instrucciones[0], new RegExp(`^Desde el pasillo ${origen.toUpperCase()},`));
    assert.doesNotMatch(r.instrucciones[0], /^Gira/, 'el primer paso no debe empezar con un giro');
    assert.match(r.instrucciones[r.instrucciones.length - 1], /^Llegaste/);
    assert.strictEqual(r.tramos.length, r.instrucciones.length, 'tramos e instrucciones desalineados');
    assert.ok(r.tramos.every((t, i) => i === 0 || t >= r.tramos[i - 1]), 'tramos no crecientes');
    assert.ok(!r.instrucciones.some((t) => /Desde la entrada/.test(t)));
  }
  assert.ok(probados > 5);
});

test('todas las parejas origen/destino producen ruta sin lanzar', () => {
  const muestra = ids.filter((_, i) => i % 7 === 0).slice(0, 12);
  for (const o of muestra) {
    for (const d of muestra) {
      if (o === d) continue;
      const r = motor.calcularRuta(d, { desde: o });
      assert.ok(r.puntos.length >= 2);
      assert.strictEqual(r.tramos.length, r.instrucciones.length);
    }
  }
});

test('origen igual al destino no lanza', () => {
  assert.doesNotThrow(() => motor.calcularRuta(ids[0], { desde: ids[0] }));
});

test('pasillo de origen desconocido lanza', () => {
  assert.throws(() => motor.calcularRuta(ids[0], { desde: 'zzz-no-existe' }), /origen desconocido/);
});

test('normalizarPasillo interpreta texto y voz', async () => {
  const { normalizarPasillo } = await import('../frontend/public/js/pasillo.js');
  const n = (t) => normalizarPasillo(t, ids);
  const con = ids.find((i) => /^13b$/i.test(i));
  assert.ok(con, 'el plano debe tener 13b');
  for (const t of ['13b', '13B', ' Pasillo 13 B ', 'estoy en el pasillo 13b', 'trece be']) {
    assert.deepStrictEqual(n(t), { id: con }, t);
  }
  assert.deepStrictEqual(n('2a'), { id: '02a' });
  assert.strictEqual(n('13').error, 'ambiguo');
  assert.strictEqual(n('').error, 'vacio');
  assert.strictEqual(n('99z').error, 'desconocido');
  assert.strictEqual(n('hola').error, 'desconocido');
});

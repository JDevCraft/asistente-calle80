// Catálogo recortado para cada pregunta: en vez de mandarle al modelo los ~2.500 segmentos (~28 mil tokens), se le
// mandan los más parecidos a la pregunta (~2–3 mil tokens). El catálogo completo no se pierde: sigue en _catalog.js
// y se usa entero si algo de esto falla.
//
// Cómo elige: (1) convierte la pregunta en vector con NVIDIA (~0,3 s) y toma los TOP segmentos más parecidos según los
// vectores precalculados (scripts/build_vectores.js); (2) suma los segmentos cuyo nombre contiene una palabra de la
// pregunta (para no perder coincidencias exactas); (3) lista además las familias que no quedaron, para que el modelo
// sepa que existen.
const fs = require('fs'), path = require('path');
const { CATALOG } = require('./_catalog');
const IDX = require('./_destinos.json');

const TOP = 150, MAX_PALABRA = 40, EMB_MS = 4000;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const STOP = new Set('DE DEL LA EL LOS LAS UN UNA Y O A EN PARA CON SIN POR MI MIS SU QUE ME SE LO LE NECESITO QUIERO BUSCO ALGO TENGO HACER COMO ESTA ESTE VOY'.split(' '));

let D = null; // datos cargados una vez por instancia
function datos() {
  if (D) return D;
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '_vectores.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(__dirname, '_vectores.bin'));
  const V = new Int8Array(bin.buffer, bin.byteOffset, bin.length), dim = meta.dim, n = meta.segs.length;
  const normas = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < dim; k++) { const x = V[i * dim + k]; s += x * x; } normas[i] = Math.sqrt(s) || 1; }
  const info = new Map(); let fam = '';
  for (const l of CATALOG.split('\n')) {
    if (l.startsWith('## ')) fam = l.slice(3);
    else { const m = /^(\d+) (.*)$/.exec(l); if (m) info.set(+m[1], { fam, t: m[2], k: ' ' + norm(m[2]).replace(/[^A-Z0-9]+/g, ' ') + ' ' }); }
  }
  const familias = [...new Set([...info.values()].map(x => x.fam))];
  D = { meta, V, dim, n, normas, info, familias };
  return D;
}

async function vectorPregunta(text, key, modelo) {
  const r = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST', signal: AbortSignal.timeout(EMB_MS),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: modelo, input: [text], input_type: 'query', encoding_format: 'float', truncate: 'END' })
  });
  if (!r.ok) throw new Error('embed ' + r.status);
  return (await r.json()).data[0].embedding;
}

// Devuelve { cat, segs, ms } con el catálogo recortado en el mismo formato de _catalog.js, o null si no se puede
async function catalogoPara(text, key) {
  if (!key) return null;
  const t0 = Date.now();
  let d; try { d = datos(); } catch (e) { console.error('recorte sin vectores', e.message); return null; }
  const q = await vectorPregunta(text, key, d.meta.modelo);
  const sc = new Float32Array(d.n);
  for (let i = 0; i < d.n; i++) { let s = 0; const o = i * d.dim; for (let k = 0; k < d.dim; k++) s += q[k] * d.V[o + k]; sc[i] = s / d.normas[i]; }
  const orden = [...sc.keys()].sort((a, b) => sc[b] - sc[a]);
  const elegidos = new Set(orden.slice(0, TOP).map(i => d.meta.segs[i]));
  // coincidencias por palabra (singular sencillo), hasta MAX_PALABRA más
  const ws = norm(text).replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w))
    .flatMap(w => [w, w.replace(/ES$/, ''), w.replace(/S$/, '')]).filter(w => w.length >= 4);
  let extra = 0;
  if (ws.length) for (const [n, x] of d.info) { if (extra >= MAX_PALABRA) break; if (!elegidos.has(n) && ws.some(w => x.k.includes(' ' + w))) { elegidos.add(n); extra++; } }
  // (2b) segmentos donde el índice ubica cada tipo de producto nombrado (p. ej. TEE → también «Accesorios cielos rasos», que ni el vector ni el nombre alcanzan)
  let porTipo = 0;
  for (const w of norm(text).replace(/[^A-Z0-9]+/g, ' ').split(' ')) {
    if (w.length < 3 || STOP.has(w)) continue;
    for (const c of Object.keys(IDX.tipos[w] || {})) { const sg = IDX.conjs[c] && IDX.conjs[c].s; if (porTipo < MAX_PALABRA && sg != null && d.info.has(sg) && !elegidos.has(sg)) { elegidos.add(sg); porTipo++; } }
  }
  const porFam = new Map();
  for (const n of [...elegidos].sort((a, b) => a - b)) { const x = d.info.get(n); if (x) (porFam.get(x.fam) || porFam.set(x.fam, []).get(x.fam)).push(`${n} ${x.t}`); }
  const otras = d.familias.filter(f => !porFam.has(f));
  const cat = [...porFam].map(([f, xs]) => `## ${f}\n${xs.join('\n')}`).join('\n') +
    (otras.length ? `\n\n(Otras familias de la tienda, sin segmentos relevantes para esta necesidad: ${otras.join(', ')})` : '');
  return { cat, segs: elegidos.size, extra, ms: Date.now() - t0 };
}

module.exports = { catalogoPara };

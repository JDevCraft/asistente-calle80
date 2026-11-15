// Convierte cada segmento del catálogo (backend/api/_catalog.js) en un vector con el modelo de embeddings de NVIDIA y los guarda
// para que la función /api/sample le mande al modelo solo los segmentos parecidos a la pregunta (ver backend/api/_recorte.js).
//
// Uso (desde la carpeta del proyecto), con la clave en una variable de entorno:
//   NVIDIA_API_KEY=nvapi-... node scripts/build_vectores.js
// Volver a correrlo cada vez que cambie el catálogo (después de scripts/build_destinos.py). Tarda ~1 minuto.
//
// Salida:
//   backend/api/_vectores.bin   N × DIM bytes (int8): cada vector normalizado y escalado a [-127, 127]
//   backend/api/_vectores.json  { modelo, dim, segs: [números de segmento en el mismo orden], fecha }
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { CATALOG } = require(path.join(ROOT, 'backend', 'api', '_catalog'));
const MODELO = 'nvidia/nemotron-3.5-embed-1b';
const KEY = String(process.env.NVIDIA_API_KEY || '').split(/[\s,;]+/).filter(Boolean)[0] || ''; // si hay varias, la primera
if (!KEY) { console.error('Falta NVIDIA_API_KEY'); process.exit(1); }

const segs = []; let fam = '';
for (const l of CATALOG.split('\n')) {
  if (l.startsWith('## ')) fam = l.slice(3);
  else { const m = /^(\d+) (.*)$/.exec(l); if (m) segs.push({ n: +m[1], fam, t: m[2] }); }
}

async function lote(input) {
  for (let intento = 0; intento < 4; intento++) {
    const r = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODELO, input, input_type: 'passage', encoding_format: 'float', truncate: 'END' })
    });
    if (r.ok) return (await r.json()).data.map(d => d.embedding);
    console.error('  lote falló', r.status, (await r.text()).slice(0, 120), '→ reintento');
    await new Promise(z => setTimeout(z, 3000 * (intento + 1)));
  }
  throw new Error('No se pudo convertir un lote');
}

(async () => {
  const vecs = [];
  for (let i = 0; i < segs.length; i += 100) {
    vecs.push(...await lote(segs.slice(i, i + 100).map(s => `${s.fam}: ${s.t}`)));
    process.stdout.write(`\r  ${vecs.length}/${segs.length}`);
  }
  const dim = vecs[0].length, buf = Buffer.alloc(segs.length * dim);
  vecs.forEach((v, i) => {
    const mx = Math.max(...v.map(Math.abs)) || 1;
    for (let k = 0; k < dim; k++) buf.writeInt8(Math.round((v[k] / mx) * 127), i * dim + k);
  });
  fs.writeFileSync(path.join(ROOT, 'backend', 'api', '_vectores.bin'), buf);
  fs.writeFileSync(path.join(ROOT, 'backend', 'api', '_vectores.json'), JSON.stringify({ modelo: MODELO, dim, segs: segs.map(s => s.n), fecha: new Date().toISOString().slice(0, 10) }));
  console.log(`\nOK: ${segs.length} segmentos, ${dim} dimensiones, ${(buf.length / 1048576).toFixed(1)} MB`);
})().catch(e => { console.error(e.message); process.exit(1); });

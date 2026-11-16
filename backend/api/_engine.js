// Motor de destinos: decide si responder directo, preguntar o pedir el uso.
// Un destino es un grupo de pasillos contiguos (una sola ruta los cubre).
// Datos: api/_destinos.json, generado por scripts/build_destinos.py desde el Excel.
const IDX = require('./_destinos.json');

const MAX_PASILLOS = 4;      // pasillos por destino
const DIRECTO = 0.80;        // un destino con 80 % o más → directo
const PRINCIPAL_MIN = 0.35;  // para preguntar, el principal debe tener 35 % o más
const RELEV_PCT = 0.10, RELEV_SKUS = 3; // destino relevante
const OPCION_SKUS = 10;      // un destino con 10 SKUs o más siempre es opción
const ALT_SKUS = 3;          // "También hay en…"
const MAX_OPC = 4, MAX_GEN = 6;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const STOP = new Set(('DE DEL LA EL LOS LAS UN UNA UNOS UNAS Y O A EN PARA CON SIN POR MI MIS SU SUS QUE ME TE SE LO LE ' +
  'NECESITO QUIERO BUSCO BUSCAR COMPRAR TIENEN TIENE HAY DONDE ESTA ESTAN QUISIERA ME GUSTARIA NECESITA ALGO UN POR FAVOR').split(' '));

// Palabras del cliente que indican un espacio o uso del catálogo
const ESPACIO_PAL = {
  'Baño': 'BANO BANOS DUCHA SANITARIO INODORO LAVAMANOS',
  'Cocina y comedor': 'COCINA COMEDOR LAVAPLATOS',
  'Sala y decoración': 'SALA SALON DECORACION DECORATIVO',
  'Habitación': 'HABITACION ALCOBA CUARTO DORMITORIO',
  'Entrada': 'ENTRADA PUERTA',
  'Auto y moto': 'CARRO CARROS AUTO AUTOS AUTOMOVIL VEHICULO CAMIONETA MOTO MOTOS',
  'Mascotas': 'MASCOTA MASCOTAS PERRO PERROS GATO GATOS CACHORRO PERRITO GATITO',
  'Infantil': 'NINO NINOS NINA NINAS INFANTIL BEBE BEBES',
  'Exterior, jardín y piscina': 'EXTERIOR JARDIN PISCINA PATIO TERRAZA BALCON',
  'Estudio y oficina': 'OFICINA ESTUDIO ESCRITORIO',
  'Lavandería y aseo': 'LAVANDERIA ROPA',
  'Navidad y temporada': 'NAVIDAD NAVIDENO NAVIDENA'
};
const PAL_ESP = new Map();
for (const [e, ws] of Object.entries(ESPACIO_PAL)) for (const w of ws.split(' ')) PAL_ESP.set(w, e);

// Nombres cortos para las opciones
const ESP_CORTO = { 'Sala y decoración': 'Sala', 'Habitación': 'Habitación', 'Entrada': 'Entrada', 'Cocina y comedor': 'Cocina',
  'Exterior, jardín y piscina': 'Exterior y jardín', 'Navidad y temporada': 'Navidad', 'Auto y moto': 'Carro y moto',
  'Lavandería y aseo': 'Aseo', 'Tecnología y hogar inteligente': 'Tecnología', 'Estudio y oficina': 'Oficina' };

// Sinónimos en ambos sentidos: tapete ↔ alfombra, limpiapies
const EXTRA_SIN = { COMIDA: ['ALIMENTO', 'CONCENTRADO'], ALFOMBRA: ['TAPETE'], BOMBILLA: ['BOMBILLO'], TAPAPIES: ['LIMPIAPIES'] };
const SIN = new Map();
for (const [w, eqs] of Object.entries({ ...EXTRA_SIN, ...(IDX.sinonimos || {}) })) {
  const g = [w, ...eqs];
  for (const x of g) SIN.set(x, [...new Set([...(SIN.get(x) || []), ...g])]);
}
const TIPOS = IDX.tipos;
function variants(w) { // singular sencillo
  const v = [w];
  if (w.endsWith('ES') && w.length > 4) v.push(w.slice(0, -2));
  if (w.endsWith('S') && w.length > 3) v.push(w.slice(0, -1));
  return v;
}
function tipoDe(w) {
  for (const v of variants(w)) {
    const grupo = (SIN.get(v) || [v]).flatMap(x => [x, ...variants(x)]).filter(x => TIPOS[x]);
    if (grupo.length) return { palabra: v, tipos: [...new Set(grupo)] };
  }
  return null;
}
const tokens = text => norm(text).replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// ---------- Destinos ----------
const P = IDX.pasillos;
const sumVals = o => Object.values(o).reduce((a, b) => a + b, 0);

// counts: {pasillo: skus}; info: {pasillo: {espacio: skus}}, conj: {pasillo: {conjKey: skus}}
const zonaDe = a => { const m = /^\d+([a-z]+)$/.exec(a); return m && !/^[abc]$/.test(m[1]) && !(P[a] && P[a].m) ? m[1] : null; };
function agrupar(counts) {
  const left = new Map(Object.entries(counts).filter(([, n]) => n > 0));
  const out = [], zonas = new Map();
  for (const a of [...left.keys()]) { const z = zonaDe(a); if (z) { zonas.set(z, (zonas.get(z) || []).concat(a)); left.delete(a); } }
  for (const g of zonas.values()) out.push(g);
  while (left.size) {
    const [seed] = [...left.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const g = [seed]; left.delete(seed);
    // crece por vecinos, primero los de más SKUs, hasta MAX_PASILLOS
    for (;;) {
      if (g.length >= MAX_PASILLOS) break;
      const cand = [...new Set(g.flatMap(a => (P[a] && P[a].v) || []))].filter(a => left.has(a))
        .sort((a, b) => left.get(b) - left.get(a) || a.localeCompare(b));
      if (!cand.length) break;
      g.push(cand[0]); left.delete(cand[0]);
    }
    out.push(g);
  }
  return out;
}

const ord = a => { const m = /^(\d+)([a-z]+)$/.exec(a); return m ? m[2] + String(m[1]).padStart(3, '0') : a; };
function rango(ps) {
  // Segmento de lateral o bloque suelto: su nombre (p. ej. "02L · Muebles")
  if (ps.length === 1 && P[ps[0]] && P[ps[0]].n) return P[ps[0]].n;
  if (ps.length > 1 && ps.every(a => zonaDe(a)) && new Set(ps.map(zonaDe)).size === 1) return `Zona ${zonaDe(ps[0]).toUpperCase()}`;
  const s = [...ps].sort((a, b) => ord(a).localeCompare(ord(b))).map(x => x.toUpperCase());
  if (s.length === 1) return s[0];
  const m = s.map(x => /^(\d+)([A-Z]+)$/.exec(x));
  if (m.every(x => x && x[2] === m[0][2])) {
    const ns = m.map(x => +x[1]);
    if (ns[ns.length - 1] - ns[0] === ns.length - 1) return `${s[0]}–${s[s.length - 1]}`;
  }
  return s.join(', ');
}

// Línea dentro de una familia: en Pintura, los adhesivos y sellantes (cemento de contacto, siliconas, sellantes de
// poliuretano o acrílicos para mesones, masillas…) son una opción aparte de los selladores tipo barniz o fondo
// (nitro, catalizados, fijadores), aunque compartan pasillo. Así "sellador" ofrece "Adhesivos y sellantes" y "Pinturas".
const RE_ADH = /ADHESIV|SELLA|SILICON|NEUTRA|MASILL|COLAS? FRIA|PEGA|EPOX|HOTMELT|NEOPRENO|CONTACTO|ESPUMA/;
const RE_ACABADO = /FONDO|NITRO|CATALIZ|FIJADOR|BARNIZ|LACA|VITRIFIC|HIDRORREPEL|ESMALTE|LATEX|OLEO|DEMARCACION|INDUSTRIAL|PAPEL/;
const lineaDe = conj => {
  const [fam, nom = ''] = String(conj).split('>');
  return /^PINTURA/.test(fam) && RE_ADH.test(nom) && !RE_ACABADO.test(nom) ? 'adh' : '';
};
const LINEA_ETQ = { adh: 'Adhesivos y sellantes' };
// Nombre corto de cada familia del catálogo, con el mismo vocabulario de las zonas del plano; la etiqueta de la
// opción en el mapa usa la familia con más SKUs del destino (más fiable que el nombre de zona más cercano)
const FAM_CORTO = { 'ACCESORIOS AUTOMOVILES': 'Autos', 'AIRE LIBRE': 'Aire libre', 'ASEO': 'Aseo', 'BANOS Y COCINAS': 'Baños & Cocinas',
  'CASA INTELIGENTE': 'Casa inteligente', 'DECORACION': 'Decoración', 'ELECTRICIDAD': 'Eléctricos', 'ELECTROHOGAR': 'Electrohogar',
  'FERRETERIA': 'Ferretería', 'FIERRO/HIERRO/ACERO': 'Fierros y aceros', 'HERRAMIENTAS Y MAQUINARIAS': 'Herramientas',
  'ILUMINACION Y VENTILADORES': 'Iluminación', 'JARDIN': 'Jardín', 'MADERA Y TABLEROS': 'Maderas', 'MASCOTAS': 'Mascotas',
  'MENAJE': 'Hogar & Menaje', 'MUEBLES': 'Muebles', 'OBRA GRUESA': 'Obra gruesa', 'ORGANIZACION': 'Organización',
  'PINTURA Y ACCESORIOS': 'Pinturas', 'PISOS': 'Pisos & Paredes', 'PLOMERIA / GASFITERIA': 'Plomería',
  'PUERTAS/VENTANAS/MOLDURAS': 'Puertas & Ventanas', 'TABIQUERIA/TECHUMBRE/AISLACION': 'Techos y muros', 'TEMPORADA': 'Temporada' };

// entradas: [{conj, a:{pasillo:n}}] → destinos ordenados; cada línea (ver lineaDe) se agrupa por separado
function destinos(entradas) {
  const lineas = new Map();
  for (const x of entradas) { const l = lineaDe(x.conj); lineas.set(l, (lineas.get(l) || []).concat(x)); }
  if (lineas.size < 2) return destinosLinea(entradas, [...lineas.keys()][0] || '');
  const partes = [...lineas].map(([l, xs]) => destinosLinea(xs, l));
  const total = partes.reduce((s, r) => s + r.total, 0);
  const lista = partes.flatMap(r => r.lista.map(d => ({ ...d, pct: Math.round((d.skus / total) * 1000) / 1000 })));
  const vistos = new Set();
  for (const d of lista) { if (vistos.has(d.id)) d.id += '-' + (d.linea || 'x'); vistos.add(d.id); }
  lista.sort((a, b) => b.skus - a.skus);
  return { total, lista };
}
function destinosLinea(entradas, linea) {
  const counts = {}, esp = {}, conjs = {};
  for (const { conj, a } of entradas) {
    const e = (IDX.conjs[conj] && IDX.conjs[conj].e) || 'Otros';
    for (const [p, n] of Object.entries(a)) {
      counts[p] = (counts[p] || 0) + n;
      (esp[p] = esp[p] || {})[e] = (esp[p][e] || 0) + n;
      (conjs[p] = conjs[p] || {})[conj] = (conjs[p][conj] || 0) + n;
    }
  }
  const total = sumVals(counts);
  if (!total) return { total: 0, lista: [] };
  const lista = agrupar(counts).map(g => {
    const skus = g.reduce((s, p) => s + counts[p], 0);
    const e = {}, c = {};
    for (const p of g) {
      for (const [k, n] of Object.entries(esp[p])) e[k] = (e[k] || 0) + n;
      for (const [k, n] of Object.entries(conjs[p])) c[k] = (c[k] || 0) + n;
    }
    const pasillos = [...g].sort((a, b) => counts[b] - counts[a]);
    const espacios = Object.entries(e).sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= Math.max(1, skus * 0.08)).map(([k]) => k);
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
    const fams = {}; for (const [k, v] of top) { const f = k.split('>')[0]; fams[f] = (fams[f] || 0) + v; }
    const famTop = Object.entries(fams).sort((a, b) => b[1] - a[1])[0];
    return {
      id: rango(g).replace(/[–, ]+/g, '-'),
      rango: rango(g),
      lugar: g.length === 1 && P[g[0]] && P[g[0]].t ? (P[g[0]].t === 'bloque' ? 'Bloque' : 'Lateral') : null,
      pasillos: pasillos.map(x => x.toUpperCase()),
      principal: pasillos[0].toUpperCase(),
      enMapa: pasillos.some(p => P[p] && P[p].m),
      skus: Math.round(skus),
      pct: Math.round((skus / total) * 1000) / 1000,
      espacios: espacios.slice(0, 4),
      conjuntos: top.slice(0, 4).map(([k]) => (IDX.conjs[k] && IDX.conjs[k].n) || k.split('>')[1]),
      conjKeys: top.map(([k]) => k),
      familia: (famTop && FAM_CORTO[famTop[0]]) || null
    };
  }).sort((a, b) => b.skus - a.skus);
  for (const d of lista) {
    d.etiqueta = LINEA_ETQ[linea] || d.espacios.slice(0, 3).map(e => ESP_CORTO[e] || e).join(', ') || 'Otros';
    if (linea) d.linea = linea;
  }
  // Mismo uso, una parte sin mapa: es una sola opción; la ruta va a la parte dibujada
  const out = [];
  for (const d of lista) {
    const host = out.find(o => o.etiqueta === d.etiqueta && o.enMapa !== d.enMapa);
    if (!host) { out.push(d); continue; }
    const [m, u] = host.enMapa ? [host, d] : [d, host];
    const merged = { ...m, skus: host.skus + d.skus, pct: Math.round((host.pct + d.pct) * 1000) / 1000,
      pasillos: [...m.pasillos, ...u.pasillos], sinMapa: [...(m.sinMapa || []), ...u.pasillos], rango: m.rango, otrosLugares: [...(m.otrosLugares || []), u.rango],
      id: `${m.id}+${u.id}`, conjuntos: [...new Set([...host.conjuntos, ...d.conjuntos])].slice(0, 4),
      conjKeys: [...new Set([...host.conjKeys, ...d.conjKeys])] };
    out[out.indexOf(host)] = merged;
  }
  out.sort((a, b) => b.skus - a.skus);
  return { total: Math.round(total), lista: out };
}
// Dos opciones que dicen lo mismo (mismo uso en lugares distintos) se distinguen por lo que hay allí
function etiquetar(ds) {
  const n = new Map(); ds.forEach(d => n.set(d.etiqueta, (n.get(d.etiqueta) || 0) + 1));
  return ds.map(d => n.get(d.etiqueta) > 1 ? { ...d, etiqueta: `${d.etiqueta}: ${cap(d.conjuntos[0] || d.rango)}` } : d);
}
const cap = s => String(s).toLowerCase().replace(/^./, c => c.toUpperCase());

// Reglas de decisión (documento de segmentación por destino)
function decidir({ total, lista }) {
  if (!lista.length) return { decision: 'sin_destino', total, destinos: [] };
  const top = lista[0];
  const relev = lista.filter(d => d.pct >= RELEV_PCT && d.skus >= RELEV_SKUS);
  const slim = d => { const { conjKeys, ...r } = d; return r; };
  const fin = ds => etiquetar(ds.map(slim));
  if (top.pct >= DIRECTO || relev.length <= 1) {
    const alt = lista.slice(1).filter(d => d.skus >= ALT_SKUS).slice(0, 3);
    return { decision: 'directo', total, destinos: fin([top, ...alt]), alternativa: top.pct < DIRECTO };
  }
  if (relev.length <= MAX_OPC && top.pct >= PRINCIPAL_MIN) {
    const ops = lista.filter(d => relev.includes(d) || d.skus >= OPCION_SKUS).slice(0, MAX_OPC + 1);
    return { decision: 'preguntar', total, destinos: fin(ops) };
  }
  return { decision: 'generico', total, destinos: fin(lista.filter(d => d.skus >= RELEV_SKUS).slice(0, MAX_GEN)) };
}

// ---------- Camino rápido: la consulta es un tipo de producto (+ uso opcional) ----------
// laxo: las palabras que el índice no entiende se ignoran (p. ej. "jarra de jugo" → jarra) en vez de pasar al modelo.
// Se usa como respaldo cuando el modelo no responde.
function rapido(text, { laxo = false } = {}) {
  const ws = tokens(text).filter(w => !STOP.has(w));
  if (!ws.length || ws.length > 4) return null;
  let t = null, ti = -1;
  for (let i = 0; i < ws.length; i++) { t = tipoDe(ws[i]); if (t) { ti = i; break; } }
  if (!t) return null;
  const resto = ws.filter((_, i) => i !== ti);
  let entradas = [];
  for (const tp of t.tipos) for (const [conj, a] of Object.entries(TIPOS[tp])) entradas.push({ conj, a, tipo: tp });
  const filtros = [];
  for (const w of resto) {
    const esp = PAL_ESP.get(w);
    const vs = variants(w);
    const porNombre = entradas.filter(x => {
      const nombre = ' ' + norm(x.conj.split('>')[1]).replace(/[^A-Z0-9]+/g, ' ') + ' ';
      return vs.some(v => v.length >= 4 && nombre.includes(' ' + v));
    });
    const sub = porNombre.length ? porNombre : entradas.filter(x => esp && IDX.conjs[x.conj] && IDX.conjs[x.conj].e === esp);
    if (!sub.length) { if (laxo) continue; return null; } // palabra que el índice no entiende → camino con modelo
    entradas = sub; filtros.push(w);
  }
  const r = decidir(destinos(entradas));
  const nombre = cap(t.palabra);
  return {
    // en modo laxo la consulta es el producto + las palabras que sí se usaron (no la frase completa del cliente)
    ...r, fuente: 'indice', consulta: filtros.length ? (laxo ? cap([t.palabra, ...filtros].join(' ')) : cap(String(text).trim())) : nombre, tipos: t.tipos, filtros,
    conjs: filtros.length ? [...new Set(entradas.map(x => x.conj))] : null,
    pregunta: r.decision === 'preguntar' ? `¿Qué tipo de ${nombre.toLowerCase()} buscas?`
      : r.decision === 'generico' ? '¿Para qué lo necesitas?' : null
  };
}

// ---------- Camino con modelo: destinos de los segmentos del grupo principal ----------
const SEG2CONJ = new Map();
for (const [k, c] of Object.entries(IDX.conjs)) if (c.s != null) SEG2CONJ.set(c.s, k);
function desdeSegmentos(segs) {
  const entradas = [...new Set(segs)].map(s => SEG2CONJ.get(s)).filter(Boolean).map(conj => ({ conj, a: IDX.conjs[conj].a }));
  return decidir(destinos(entradas));
}

module.exports = { rapido, desdeSegmentos, tokens, destinos };

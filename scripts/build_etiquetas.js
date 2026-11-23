// Genera frontend/public/data/etiquetas_destino.json: etiqueta de un solo nivel (producto) por tipo de producto y destino,
// para las búsquedas genéricas que hoy muestran prefijos internos, listas de usos, laterales o etiquetas repetidas.
// Uso: node scripts/build_etiquetas.js   (revisar la salida antes de publicar)
const fs = require('fs'), path = require('path');
const { rapido } = require('../backend/api/_engine.js');
const IDX = require('../backend/api/_destinos.json');
const CORTOS = require('../frontend/public/data/nombres_cortos.json');
// Nombres elegidos a mano (tienen prioridad sobre los generados)
const MANUAL = {
  SILLA: { '24A-27A': 'Sillas de oficina', '02L-·-Muebles': 'Sillas de comedor', '08A-11A+11L': 'Sillas de exterior madera', '12A-14A': 'Sillas de exterior ratán', '02L-·-Aire-libre': 'Sillas plegables de exterior' },
  TAPETE: { '19A-22A': 'Tapetes para sala y habitación', '31A': 'Tapetes de baño', '11C-12C+01E': 'Tapetes de carro', '07A-08A+Zona-D': 'Tapetes para mascotas' },
  MATERA: { '01A-03A-04A-05A': 'Macetas plásticas', '02A-05A+01A': 'Macetas plásticas', '02L-·-Aire-libre': 'Macetas de cerámica', '01L-·-Jardín': 'Jardín vertical' },
  MESA: { '24A-27A': 'Mesas de centro y auxiliares', '10A-11A-12A-14A+22A-23A': 'Mesas de exterior', '02L-·-Aire-libre': 'Mesas plásticas y multiuso', '10B': 'Tablas de planchar', '02L-·-Muebles': 'Mesas laterales y plegables' },
  CAMA: { '07A+Zona-D+08L': 'Camas para mascotas', '33A-34A': 'Ropa de cama', '02L-·-Aire-libre': 'Más camas para mascotas' },
  SOPORTE: { '28A-30A': 'Soportes para repisa y TV', '34A-35A+28C': 'Soportes y ganchos decorativos', '17C-20C': 'Escuadras y soportes', '10C-12C': 'Soportes para celular y auto', '09A-10A': 'Hamacas y accesorios' },
  PROTECTOR: { '32A-33A': 'Cubrecolchones', '09B-11B': 'Protección para pintura y tapicería', '11C-12C': 'Protectores de carro', '06C-08C-09C': 'Protectores de voltaje', '29A-30A': 'Protección infantil y salvalozas' },
  CINTA: { '17C-20C+17L': 'Cintas de empaque y doble faz', 'Zona-P': 'Cintas para obra', '10B-11B': 'Cintas para pintura', '13C': 'Cintas aisladoras', '44A-45A': 'Cintas de teflón y reparación' },
  REPISA: { '28A-30A': 'Repisas', '40A-42A': 'Repisas de baño', '24A-27A': 'Estantes y libreros de oficina' },
  ORGANIZADOR: { '28A-30A': 'Organizadores para el hogar', '08C-11C': 'Organizadores de cables y auto' },
  TUBO: { '44A-45A': 'Tubos PVC', 'Zona-P': 'Tubos y perfiles de obra', '18C-20C': 'Barras de clóset', '08C-09C': 'Tubos eléctricos', '35A': 'Tubos cromados', '03L-·-Decoración': 'Más tubos cromados' },
  MANGUERA: { '05A-08A': 'Mangueras de jardín', '44A-45A': 'Mangueras de agua y flexibles', '16C': 'Accesorios de hidrolavadora', '14C': 'Niveles', '42A': 'Flexibles de baño', '09A-11A': 'Limpiafondos de piscina' },
  CARGADOR: { '09C-12C': 'Cargadores y power banks', '03A+Zona-D': 'Morrales para mascotas', '14C-15C': 'Cargadores para herramientas' },
  LIMPIADOR: { '09B-11B': 'Limpiadores para el hogar', '10C-12C': 'Limpiadores para carro' },
  CANASTA: { '28A-30A': 'Cajas y canastos', '09B-10B': 'Canastos para ropa', '15A-17A': 'Paneras y utensilios de cocina' },
  BOLSA: { '09B-10B+00B': 'Bolsas de basura', '28A-30A': 'Bolsos y space bags', '06A-09A': 'Bolsas de camping y navidad', '35A-36A': 'Repuestos de electrodomésticos', 'Zona-D': 'Bolsas para mascotas' }
};
const corto = c => CORTOS[String(c).trim()] || null;
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const generico = c => /^(OTROS?|VARIOS?|ACCESORIOS?)\b/i.test(String(c).trim());
const out = { ...MANUAL }, log = [];
const vistos = new Set(Object.keys(MANUAL).flatMap(k => []));
for (const w of Object.keys(IDX.tipos)) {
  let r; try { r = rapido(w.toLowerCase()); } catch { continue; }
  if (!r || r.decision === 'directo' || !r.destinos || r.destinos.length < 2 || r.filtros.length) continue;
  const tipo = r.tipos[0]; if (out[tipo]) continue;
  const ds = r.destinos;
  const mal = ds.some(d => /:/.test(d.etiqueta) || d.etiqueta.split(',').length >= 3 || /·/.test(d.rango)) ||
    new Set(ds.map(d => d.familia)).size < ds.length || new Set(ds.map(d => d.etiqueta)).size < ds.length;
  if (!mal) continue;
  const usados = new Set(), m = {}; let ok = true;
  for (const d of ds) {
    // solo conjuntos que nombran el producto buscado (si no, la etiqueta sería de otro producto: «Ollas» para «estufa»)
    const raiz = r.tipos.map(t => t.replace(/(ES|S)$/, '')).filter(t => t.length >= 4);
    const c = (d.conjuntos || []).filter(x => !generico(x) && raiz.some(t => norm(x).includes(t))).map(corto).filter(Boolean).find(n => !usados.has(n.toLowerCase()));
    if (!c) { ok = false; break; }
    usados.add(c.toLowerCase()); m[d.id] = c;
  }
  if (!ok) { log.push('SIN NOMBRE ' + w + ': ' + ds.map(d => d.etiqueta).join(' ; ')); continue; }
  out[tipo] = m; log.push(w + ' → ' + ds.map(d => m[d.id]).join(' | '));
}
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'public', 'data', 'etiquetas_destino.json'), JSON.stringify(out, null, 1));
console.log(log.join('\n')); console.log('tipos con etiquetas:', Object.keys(out).length);

// Comprueba los links del frontend. Uso:
//   node scripts/check_links.js            → offline: marca #, vacíos y rutas internas inexistentes
//   node scripts/check_links.js --online   → además hace GET a cada URL externa (falla en >=400)
// Sin dependencias: solo fs, path y fetch de Node >= 20.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'frontend', 'public');
const ONLINE = process.argv.includes('--online');

// Rutas que el servidor resuelve sin archivo en public/ (ver frontend/vercel.json).
const RUTAS_VIRTUALES = [/^\/api\//];

// Solo recursos y navegación: <link rel="preconnect"> y dns-prefetch no son URLs que se carguen.
function extraerLinks(html) {
  const out = [];
  const re = /<(a|link|img|script)\b([^>]*?)\s(href|src)=["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/rel=["']?(preconnect|dns-prefetch)/i.test(m[2])) continue;
    out.push({ tag: m[1], attr: m[3], url: m[4] });
  }
  return out;
}

// Rutas relativas (css/app.css, js/app.js, img/…) y absolutas (/favicon.ico) se resuelven contra frontend/public.
function revisarInterno(url) {
  if (RUTAS_VIRTUALES.some(r => r.test(url))) return null;
  const limpia = url.split(/[?#]/)[0];
  if (limpia === '' || limpia === '/') return null;
  const archivo = path.join(PUBLIC, limpia.replace(/^\//, ''));
  return fs.existsSync(archivo) ? null : `no existe en frontend/public: ${url}`;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function revisarExterno(url) {
  try {
    // UA de navegador: varios sitios de comercio devuelven 403 a clientes sin UA
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    // 403 suele ser protección anti-bot de terceros (el link sí abre en navegador): se reporta como aviso
    if (r.status === 403) return { aviso: `HTTP 403 (anti-bot?): ${url}` };
    return r.status >= 400 ? `HTTP ${r.status}: ${url}` : null;
  } catch (e) {
    return `error de red: ${url} (${e.name})`;
  }
}

async function main() {
  const archivo = path.join(PUBLIC, 'index.html');
  const links = extraerLinks(fs.readFileSync(archivo, 'utf8'));
  const errores = [];
  const externos = new Set();

  for (const { tag, attr, url } of links) {
    const ref = `${tag}[${attr}="${url}"]`;
    if (url === '' || url === '#') { errores.push(`${ref}: link vacío o "#"`); continue; }
    if (/^https?:\/\//i.test(url)) { externos.add(url); continue; }
    if (/^(mailto:|tel:|data:)/i.test(url)) continue;
    const e = revisarInterno(url);
    if (e) errores.push(`${ref}: ${e}`);
  }

  const avisos = [];
  if (ONLINE) {
    for (const url of externos) {
      const e = await revisarExterno(url);
      if (e && e.aviso) avisos.push(e.aviso);
      else if (e) errores.push(`externo ${e}`);
    }
  }

  console.log(`links revisados: ${links.length} (externos: ${externos.size}${ONLINE ? '' : ', sin consultar; usar --online'})`);
  if (avisos.length) console.warn(avisos.map(a => `  ! ${a}`).join('\n'));
  if (errores.length) {
    console.error(errores.map(e => `  ✗ ${e}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('ok');
  }
}

main();

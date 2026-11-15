// Caché y rate-limit compartidos entre instancias (Upstash Redis, vía REST). Sin Redis configurado,
// o ante cualquier error de Redis, no limita ni cachea — igual que el resto de la app se degrada
// sin claves de IA, en vez de romper la petición.
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CACHE_TTL_S = 6 * 60 * 60; // 6 h, igual que el CACHE_MS actual de api/sample.js
const RATE_LIMIT = 20, RATE_WINDOW_S = 600; // 20 peticiones / 10 min por IP, igual que LIMIT/WINDOW_MS actuales

const PIPELINE_TIMEOUT_MS = 2000; // Redis lento no debe colgar la petición hasta el límite de 60s de Vercel

async function pipeline(cmds) {
  const r = await fetch(`${BASE}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(PIPELINE_TIMEOUT_MS)
  });
  return r.json();
}

async function cacheGet(key) {
  if (!BASE) return null;
  try {
    const [{ result } = {}] = await pipeline([['GET', `c:${key}`]]);
    return result ? JSON.parse(result) : null;
  } catch (e) { console.error('estado cacheGet', e && e.message); return null; }
}

async function cacheSet(key, value) {
  if (!BASE) return;
  try { await pipeline([['SET', `c:${key}`, JSON.stringify(value), 'EX', CACHE_TTL_S]]); }
  catch (e) { console.error('estado cacheSet', e && e.message); }
}

async function limitado(ip) {
  if (!BASE) return false;
  try {
    const key = `rl:${ip}`;
    // INCR y EXPIRE NX en el mismo pipeline (un solo viaje de red): si el INCR no llega,
    // el EXPIRE tampoco se envía, así nunca queda un contador sin TTL por una falla a medias.
    const [{ result: count } = {}] = await pipeline([['INCR', key], ['EXPIRE', key, RATE_WINDOW_S, 'NX']]);
    return count > RATE_LIMIT;
  } catch (e) { console.error('estado limitado', e && e.message); return false; }
}

module.exports = { limitado, cacheGet, cacheSet };

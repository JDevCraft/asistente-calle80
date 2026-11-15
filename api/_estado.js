// Caché y rate-limit compartidos entre instancias (Upstash Redis, vía REST). Sin Redis configurado,
// o ante cualquier error de Redis, no limita ni cachea — igual que el resto de la app se degrada
// sin claves de IA, en vez de romper la petición.
const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CACHE_TTL_S = 6 * 60 * 60; // 6 h, igual que el CACHE_MS actual de api/sample.js

async function pipeline(cmds) {
  const r = await fetch(`${BASE}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds)
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

module.exports = { cacheGet, cacheSet };

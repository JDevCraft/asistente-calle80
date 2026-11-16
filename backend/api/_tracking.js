// Registro estructurado de búsquedas para la beta (Postgres en Neon, vía su driver HTTP: cada consulta
// es un POST con fetch, no el protocolo TCP de Postgres). Igual que _estado.js con Redis: sin cadena de
// conexión configurada, o ante cualquier error de la base, no registra nada y nunca lanza — el registro
// es secundario y no debe romper ni demorar la respuesta al cliente.
const { neon } = require('@neondatabase/serverless');

const CONN = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const QUERY_TIMEOUT_MS = 2000; // Postgres lento no debe colgar la petición hasta el límite de 60s de Vercel
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sql = CONN ? neon(CONN) : null;

// sql.query(texto, params, opts): consulta parametrizada ($1, $2...), nunca SQL interpolado.
// fetchOptions se mezcla en el init de fetch, así que el AbortSignal llega a la petición HTTP.
const consultar = (texto, params, extra = {}) =>
  sql.query(texto, params, { fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) }, ...extra });

const nulo = v => (v === undefined ? null : v);

async function registrarBusqueda(datos) {
  if (!CONN) return;
  try {
    // La IP no se guarda: solo la usa api/_estado.js para el límite de tasa (con hash).
    const { id, texto, canal, resultado, proveedor, motivoRespaldo, tiempoRespuestaMs } = datos || {};
    await consultar(
      'INSERT INTO busquedas (id, texto, canal, resultado, proveedor, motivo_respaldo, tiempo_respuesta_ms) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, texto, canal, resultado, nulo(proveedor), nulo(motivoRespaldo), nulo(tiempoRespuestaMs)]
    );
  } catch (e) { console.error('tracking registrarBusqueda', e && e.message); }
}

async function registrarEncuesta(id, util) {
  if (!CONN) return;
  try {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return; // id inválido: Postgres lo rechazaría igual
    // Solo la primera respuesta cuenta: una fila ya valorada no se sobrescribe.
    await consultar('UPDATE busquedas SET util = $1 WHERE id = $2 AND util IS NULL', [util, id]);
  } catch (e) { console.error('tracking registrarEncuesta', e && e.message); }
}

// Retención: borra búsquedas más antiguas que `dias` (30 por defecto). Devuelve filas borradas o null si falla.
async function purgarBusquedas(dias = 30) {
  if (!CONN) return null;
  try {
    // fullResults: el driver devuelve { rowCount } en vez de solo las filas
    const r = await consultar("DELETE FROM busquedas WHERE creado_en < now() - ($1 || ' days')::interval", [String(dias)], { fullResults: true });
    return typeof r.rowCount === 'number' ? r.rowCount : null;
  } catch (e) { console.error('tracking purgarBusquedas', e && e.message); return null; }
}

module.exports = { registrarBusqueda, registrarEncuesta, purgarBusquedas };

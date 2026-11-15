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
const consultar = (texto, params) =>
  sql.query(texto, params, { fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) } });

const nulo = v => (v === undefined ? null : v);

async function registrarBusqueda(datos) {
  if (!CONN) return;
  try {
    const { id, texto, canal, resultado, proveedor, motivoRespaldo, tiempoRespuestaMs, ip } = datos || {};
    await consultar(
      'INSERT INTO busquedas (id, texto, canal, resultado, proveedor, motivo_respaldo, tiempo_respuesta_ms, ip) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, texto, canal, resultado, nulo(proveedor), nulo(motivoRespaldo), nulo(tiempoRespuestaMs), nulo(ip)]
    );
  } catch (e) { console.error('tracking registrarBusqueda', e && e.message); }
}

async function registrarEncuesta(id, util) {
  if (!CONN) return;
  try {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return; // id inválido: Postgres lo rechazaría igual
    await consultar('UPDATE busquedas SET util = $1 WHERE id = $2', [util, id]);
  } catch (e) { console.error('tracking registrarEncuesta', e && e.message); }
}

module.exports = { registrarBusqueda, registrarEncuesta };

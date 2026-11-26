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

// Motivos cerrados del «No» en la micro-encuesta (deben coincidir con el CHECK de backend/sql/003_sesion.sql).
const MOTIVOS = ['no_era', 'no_encontre', 'ruta_confusa', 'otro'];
const MAX_COMENTARIO = 140, MAX_CONSEJO = 300;
const uuidONulo = v => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

async function registrarBusqueda(datos) {
  if (!CONN) return;
  try {
    // La IP no se guarda: solo la usa api/_estado.js para el límite de tasa (con hash).
    const { id, texto, canal, resultado, proveedor, motivoRespaldo, tiempoRespuestaMs, sesionId, consejo } = datos || {};
    const base = [id, texto, canal, resultado, nulo(proveedor), nulo(motivoRespaldo), nulo(tiempoRespuestaMs), uuidONulo(sesionId)];
    const c = typeof consejo === 'string' ? consejo.trim().slice(0, MAX_CONSEJO) : '';
    const insertar = (cols, vals) => consultar(
      `INSERT INTO busquedas (id, texto, canal, resultado, proveedor, motivo_respaldo, tiempo_respuesta_ms, sesion_id${cols}) ` +
      `VALUES ($1, $2, $3, $4, $5, $6, $7, $8${vals})`, base.concat(cols ? [c] : []));
    // Si la columna consejo aún no existe en Neon (004_consejo.sql sin ejecutar), la búsqueda se guarda igual sin ella
    if (!c) await insertar('', '');
    else try { await insertar(', consejo', ', $9'); } catch (e) { console.error('tracking consejo', e && e.message); await insertar('', ''); }
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

// Motivo del «No» (opcional): solo sobre una fila ya valorada con util = false y sin motivo previo.
// El motivo debe estar en la lista cerrada; el comentario es texto libre opcional recortado a 140 caracteres.
async function registrarMotivo(id, motivo, comentario) {
  if (!CONN) return;
  try {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return;
    if (!MOTIVOS.includes(motivo)) return;
    const c = typeof comentario === 'string' ? comentario.trim().slice(0, MAX_COMENTARIO) : '';
    await consultar(
      'UPDATE busquedas SET motivo = $1, comentario = $2 WHERE id = $3 AND util = false AND motivo IS NULL',
      [motivo, c || null, id]
    );
  } catch (e) { console.error('tracking registrarMotivo', e && e.message); }
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

module.exports = { registrarBusqueda, registrarEncuesta, registrarMotivo, purgarBusquedas, UUID_RE };

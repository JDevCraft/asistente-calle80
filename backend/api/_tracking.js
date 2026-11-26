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

// Valores cerrados (deben coincidir con los CHECK de backend/sql/005_analitica.sql)
const ALCANCES = ['basura', 'dano', 'ilegal', 'fraude', 'inyeccion', 'tienda'];
const DECISIONES = ['directo', 'preguntar', 'generico', 'sin_destino'];
const PLATAFORMAS = ['ios', 'android', 'escritorio', 'otro'];
const TIPOS_EVENTO = ['ver_pasillos', 'ubicacion_abrir', 'ubicacion_elegida', 'ubicacion_deshacer', 'recorrido_inicio', 'recorrido_fin', 'recorrido_detener', 'recorrido_repetir', 'paso_manual', 'opcion_elegida', 'pregunta_respondida', 'pago_click', 'voz_error'];
const enLista = (l, v) => (l.includes(v) ? v : null);
const versionONula = v => (typeof v === 'string' && /^[0-9A-Za-z._-]{1,12}$/.test(v) ? v : null);
const MAX_EVENTOS = 10;

async function registrarBusqueda(datos) {
  if (!CONN) return;
  try {
    // La IP no se guarda: solo la usa api/_estado.js para el límite de tasa (con hash).
    const { id, texto, canal, resultado, proveedor, motivoRespaldo, tiempoRespuestaMs, sesionId, consejo, alcance, destino, decision, cache, nRespuestas, plataforma, version } = datos || {};
    const base = [id, texto, canal, resultado, nulo(proveedor), nulo(motivoRespaldo), nulo(tiempoRespuestaMs), uuidONulo(sesionId)];
    const c = typeof consejo === 'string' ? consejo.trim().slice(0, MAX_CONSEJO) : '';
    // Columnas de analítica: solo se incluyen las que traen valor válido (consejo primero)
    const extra = [
      ['consejo', c || null], ['alcance', enLista(ALCANCES, alcance)], ['destino', typeof destino === 'string' && destino ? destino.slice(0, 40) : null],
      ['decision', enLista(DECISIONES, decision)], ['cache', typeof cache === 'boolean' ? cache : null],
      ['n_respuestas', Number.isInteger(nRespuestas) && nRespuestas >= 0 && nRespuestas < 100 ? nRespuestas : null],
      ['plataforma', enLista(PLATAFORMAS, plataforma)], ['version', versionONula(version)]
    ].filter(([, v]) => v !== null);
    const insertar = ex => consultar(
      'INSERT INTO busquedas (id, texto, canal, resultado, proveedor, motivo_respaldo, tiempo_respuesta_ms, sesion_id' + ex.map(([k]) => ', ' + k).join('') + ') ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8' + ex.map((_, i) => ', $' + (i + 9)).join('') + ')', base.concat(ex.map(([, v]) => v)));
    // Si las columnas nuevas aún no existen en Neon (migración sin ejecutar) o un valor no cabe, la búsqueda se guarda igual sin ellas
    if (!extra.length) await insertar([]);
    else try { await insertar(extra); } catch (e) { console.error('tracking columnas extra', e && e.message); await insertar([]); }
  } catch (e) { console.error('tracking registrarBusqueda', e && e.message); }
}

// Acciones del cliente (ver pasillos, recorrido, ubicación…). evs = [{t, d, b}]: tipo cerrado, detalle corto de vocabulario controlado
// (nunca texto libre) y id de la búsqueda a la que pertenece. Descarta lo que no valida; nunca lanza.
async function registrarEventos(sesionId, evs, plataforma, version) {
  if (!CONN) return;
  try {
    const ses = uuidONulo(sesionId); if (!ses) return;
    const filas = (Array.isArray(evs) ? evs : []).slice(0, MAX_EVENTOS)
      .filter(e => e && TIPOS_EVENTO.includes(e.t))
      .map(e => [ses, uuidONulo(e.b), e.t, typeof e.d === 'string' ? e.d.replace(/[^\p{L}\p{N} _\-–·:.]/gu, '').slice(0, 40) || null : null, enLista(PLATAFORMAS, plataforma), versionONula(version)]);
    if (!filas.length) return;
    await consultar('INSERT INTO eventos (sesion_id, busqueda_id, tipo, detalle, plataforma, version) VALUES ' +
      filas.map((_, i) => '(' + [1, 2, 3, 4, 5, 6].map(k => '$' + (i * 6 + k)).join(', ') + ')').join(', '), filas.flat());
  } catch (e) { console.error('tracking registrarEventos', e && e.message); }
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
    await consultar("DELETE FROM eventos WHERE creado_en < now() - ($1 || ' days')::interval", [String(dias)]).catch(e => console.error('tracking purgar eventos', e && e.message));
    return typeof r.rowCount === 'number' ? r.rowCount : null;
  } catch (e) { console.error('tracking purgarBusquedas', e && e.message); return null; }
}

module.exports = { registrarBusqueda, registrarEventos, registrarEncuesta, registrarMotivo, purgarBusquedas, UUID_RE };

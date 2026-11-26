const { registrarEventos } = require('./_tracking');
const { limitado } = require('./_estado');

// Analítica de acciones del cliente: {sesionId, plataforma, version, eventos:[{t, d, b}]} (máximo 10 por llamada).
// Fail-open: responde 200 {} siempre que el método sea POST; lo inválido se descarta en registrarEventos.
// Contador de límite propio (120 llamadas / 10 min por IP) para no gastar el de búsquedas.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (!(await limitado(ip, { prefijo: 'ev', max: 120 }))) await registrarEventos(body.sesionId, body.eventos, body.plataforma, body.version);
  return res.status(200).json({});
};

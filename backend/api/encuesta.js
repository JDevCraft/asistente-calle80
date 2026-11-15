const { registrarEncuesta } = require('./_tracking');

// Micro-encuesta "¿te ayudó?": el cliente envía {id, util} con el id que devolvió /api/sample.
// Fail-open: responde 200 {} siempre que el método sea POST, aunque el cuerpo sea inválido o Postgres falle.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const { id, util } = body;
  // util debe ser un booleano real: "false" (texto) no se coacciona a true. Se espera (await) antes de responder
  // porque en Vercel una promesa pendiente puede congelarse; registrarEncuesta nunca lanza.
  if (typeof id === 'string' && typeof util === 'boolean') await registrarEncuesta(id, util).catch(() => {});
  return res.status(200).json({});
};

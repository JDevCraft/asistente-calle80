const { purgarBusquedas } = require('./_tracking');

// Retención de búsquedas (30 días). Lo llama Vercel Cron (ver vercel.json "crons") con
// Authorization: Bearer $CRON_SECRET. Sin el secreto configurado o con otro token, responde 401.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const esperado = process.env.CRON_SECRET;
  if (!esperado || req.headers.authorization !== `Bearer ${esperado}`) return res.status(401).json({ error: 'unauthorized' });
  const borradas = await purgarBusquedas(30);
  return res.status(200).json({ borradas });
};

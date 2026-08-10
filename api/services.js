const { getServices } = require('../lib/scheduling');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const services = await getServices();
  res.status(200).json({
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.duration_min,
      priceEur: s.price_eur,
    })),
  });
};

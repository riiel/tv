const activeClients = new Map();

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const now = Date.now();
  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const ip = rawIp.split(',')[0].trim();
  const clientId = (req.query.id || ip).slice(0, 40);

  // Verceli automaatsed asukohapäised + varuvariandina äpi enda koordinaadid
  const country = (req.headers['x-vercel-ip-country'] || req.query.country || 'EE').toUpperCase();
  const rawCity = req.headers['x-vercel-ip-city'] || req.query.city || 'Pärnu';
  let city = 'Pärnu';
  try { city = decodeURIComponent(rawCity); } catch (e) { city = rawCity; }

  const lat = parseFloat(req.query.lat || req.headers['x-vercel-ip-latitude']) || 58.3859;
  const lon = parseFloat(req.query.lon || req.headers['x-vercel-ip-longitude']) || 24.4971;

  activeClients.set(clientId, { ip, time: now, city, country, lat, lon });

  // Eemaldame seadmed, mis pole 75 sekundit märku andnud
  for (const [key, val] of activeClients.entries()) {
    if (now - val.time > 75000) {
      activeClients.delete(key);
    }
  }

  const values = [...activeClients.values()];
  const devices = values.length;
  const ips = new Set(values.map(v => v.ip)).size;

  // Koondame vaatajad linnade kaupa 3D maakera jaoks
  const cityMap = new Map();
  for (const v of values) {
    const key = `${v.city}_${v.country}`;
    const item = cityMap.get(key) || {
      city: v.city,
      country: v.country,
      lat: v.lat,
      lon: v.lon,
      count: 0
    };
    item.count++;
    cityMap.set(key, item);
  }

  res.status(200).json({
    devices,
    ips,
    locations: [...cityMap.values()].sort((a, b) => b.count - a.count)
  });
}

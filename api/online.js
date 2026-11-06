const activeClients = new Map();

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const now = Date.now();
  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const ip = rawIp.split(',')[0].trim();
  const clientId = (req.query.id || ip).slice(0, 40);

  // Salvestame seadme viimase kontakti ja IP
  activeClients.set(clientId, { ip, time: now });

  // Eemaldame seadmed, mis pole 75 sekundit märku andnud
  for (const [key, val] of activeClients.entries()) {
    if (now - val.time > 75000) {
      activeClients.delete(key);
    }
  }

  const devices = activeClients.size;
  const ips = new Set([...activeClients.values()].map(v => v.ip)).size;

  res.status(200).json({ devices, ips });
}

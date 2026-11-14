// Järve pinnavee temperatuur Soome keskkonnainstituudi (SYKE) hüdroloogia API-st.
// Leiab etteantud asukohale lähima mõõtejaama, millel on viimase 10 päeva jooksul mõõtmisi.
// Kasutus: /api/laketemp?lat=61.168&lon=25.552&lake=Vesijärvi (lake on valikuline)
// Vastus: { temp, time, station, lake, municipality, km, nearby: [...] }  (temp °C; puudumisel null)

const BASE = 'https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.2/odata';

// SYKE koordinaadid on kujul DDMMSS (nt "611012" = 61°10'12")
function ddmmss(v) {
  const s = String(v ?? '').replace(/[^0-9]/g, '');
  if (s.length < 5) return null;
  const sec = Number(s.slice(-2)), min = Number(s.slice(-4, -2)), deg = Number(s.slice(0, -4));
  if (![sec, min, deg].every(Number.isFinite) || min >= 60 || sec >= 60) return null;
  return deg + min / 60 + sec / 3600;
}

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

async function getJson(url, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    // SYKE ei luba $format parameetrit, vorming valitakse Accept päisega
    const r = await fetch(url, { signal: c.signal, headers: { Accept: 'application/json', 'User-Agent': 'koduvaade-tv (vercel)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const maxKm = Number(req.query.max) || 60;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ temp: null, error: 'lat ja lon puuduvad' });

  const since = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 19);
  const urls = [
    `${BASE}/LampoPintavesi?$filter=${encodeURIComponent(`Aika ge datetime'${since}'`)}&$orderby=Aika%20desc&$top=3000&$expand=Paikka`,
    `${BASE}/LampoPintavesi?$orderby=Aika%20desc&$top=3000&$expand=Paikka`
  ];

  const tried = [];
  for (const url of urls) {
    try {
      const data = await getJson(url);
      const rows = Array.isArray(data?.value) ? data.value : [];
      // viimane mõõtmine iga jaama kohta
      const latest = new Map();
      for (const row of rows) {
        const id = row.Paikka_Id;
        const val = Number(row.Arvo);
        if (id == null || !Number.isFinite(val) || !row.Aika) continue;
        const prev = latest.get(id);
        if (!prev || String(row.Aika) > String(prev.Aika)) latest.set(id, row);
      }
      const stations = [];
      for (const row of latest.values()) {
        const p = row.Paikka || {};
        const sLat = ddmmss(p.KoordLat), sLon = ddmmss(p.KoordLong);
        if (sLat === null || sLon === null) continue;
        stations.push({
          temp: Math.round(Number(row.Arvo) * 10) / 10,
          time: row.Aika,
          station: p.Nimi || null,
          lake: p.JarviNimi || null,
          municipality: p.KuntaNimi || null,
          km: Math.round(km(lat, lon, sLat, sLon) * 10) / 10
        });
      }
      stations.sort((a, b) => a.km - b.km);
      tried.push({ ok: true, rows: rows.length, stations: stations.length });
      // Eelista sama järve jaama (nt Vesijärv, mitte kõrvalasuv Päijänne), muidu lähim
      const wantLake = String(req.query.lake || '').toLowerCase();
      const best = (wantLake && stations.find(s => s.km <= maxKm && String(s.lake || s.station || '').toLowerCase().includes(wantLake)))
        || stations.find(s => s.km <= maxKm) || null;
      return res.status(200).json({ ...(best || { temp: null }), nearby: stations.slice(0, 5), tried });
    } catch (e) {
      tried.push({ ok: false, error: String(e && e.name === 'AbortError' ? 'timeout' : (e && e.message || e)) });
    }
  }
  return res.status(200).json({ temp: null, nearby: [], tried });
}

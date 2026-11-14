// NOAA OVATION virmaliste prognoos (järgmised ~30-90 min), hõrendatud põhjapoolkera jaoks.
// Algne fail on suur (~65 000 punkti); siit tuleb ainult see, mida kaart vajab.
// Vastus: { observed, forecast, points: [[lon, lat, tõenäosus%], ...] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', {
      signal: c.signal,
      headers: { 'User-Agent': 'koduvaade-tv (vercel)', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ov = await r.json();
    const coords = Array.isArray(ov?.coordinates) ? ov.coordinates : [];
    const points = [];
    for (const p of coords) {
      if (!Array.isArray(p) || p.length < 3) continue;
      const lon = Number(p[0]), lat = Number(p[1]), val = Number(p[2]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(val)) continue;
      if (lat < 40 || val < 3) continue;
      if (lon % 2 !== 0 || lat % 2 !== 0) continue;   // 2° võrk on kaardil piisav
      points.push([lon > 180 ? lon - 360 : lon, lat, val]);
    }
    res.status(200).json({
      observed: ov['Observation Time'] || null,
      forecast: ov['Forecast Time'] || null,
      points
    });
  } catch (e) {
    res.status(200).json({ observed: null, forecast: null, points: [], error: String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

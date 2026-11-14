// Päikesetuule andmed (Bz ja kiirus) NOAA-st läbi Verceli serveri.
// Brauser ei saa neid otse kätte, server saab. Proovib mitut NOAA aadressi järjest.
// Vastus: { bz, speed, time, sources, tried }  (bz nT, speed km/s; puudumisel null)

const BASE = 'https://services.swpc.noaa.gov';

const BZ_SOURCES = [
  `${BASE}/json/rtsw/rtsw_mag_1m.json`,
  `${BASE}/products/solar-wind/mag-5-minute.json`,
  `${BASE}/products/solar-wind/mag-2-hour.json`,
  `${BASE}/products/summary/solar-wind-mag-field.json`
];
const SPEED_SOURCES = [
  `${BASE}/json/rtsw/rtsw_wind_1m.json`,
  `${BASE}/products/solar-wind/plasma-5-minute.json`,
  `${BASE}/products/solar-wind/plasma-2-hour.json`,
  `${BASE}/products/summary/solar-wind-speed.json`
];
const BZ_KEYS = ['bz_gsm', 'bz', 'Bz'];
const SPEED_KEYS = ['proton_speed', 'speed', 'WindSpeed', 'wind_speed'];

const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Leiab viimase kehtiva väärtuse. Toetab kõiki NOAA vorme:
// [[päis...], [rida...]], [{võti: väärtus}, ...] ja üksik {võti: väärtus}.
export function pickLatest(data, keys) {
  const fromObj = o => {
    if (!o || typeof o !== 'object') return null;
    if (o.active === false) return null;
    for (const k of keys) if (k in o) { const v = num(o[k]); if (v !== null) return { value: v, time: o.time_tag || o.TimeStamp || null }; }
    return null;
  };
  if (Array.isArray(data)) {
    if (Array.isArray(data[0])) {
      const header = data[0].map(h => String(h));
      const col = header.findIndex(h => keys.includes(h));
      const timeCol = header.indexOf('time_tag');
      if (col < 0) return null;
      for (let i = data.length - 1; i >= 1; i--) {
        const v = num(data[i][col]);
        if (v !== null) return { value: v, time: timeCol >= 0 ? data[i][timeCol] : null };
      }
      return null;
    }
    // objektide massiiv: võta kõige hilisema ajaga kehtiv rida
    let best = null;
    for (const o of data) {
      const r = fromObj(o);
      if (r && (!best || String(r.time || '') >= String(best.time || ''))) best = r;
    }
    return best;
  }
  return fromObj(data);
}

async function getJson(url, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'koduvaade-tv (vercel)', 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function firstValue(urls, keys, tried) {
  for (const url of urls) {
    const short = url.replace(BASE, '');
    try {
      const data = await getJson(url);
      const r = pickLatest(data, keys);
      if (r) { tried.push({ url: short, ok: true }); return { ...r, source: short }; }
      tried.push({ url: short, ok: false, error: 'väärtus puudub' });
    } catch (e) {
      tried.push({ url: short, ok: false, error: String(e && e.name === 'AbortError' ? 'timeout' : (e && e.message || e)) });
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  const tried = [];
  const [bz, speed] = await Promise.all([
    firstValue(BZ_SOURCES, BZ_KEYS, tried),
    firstValue(SPEED_SOURCES, SPEED_KEYS, tried)
  ]);
  res.status(200).json({
    bz: bz ? Math.round(bz.value * 10) / 10 : null,
    speed: speed ? Math.round(speed.value) : null,
    time: bz?.time || speed?.time || null,
    sources: { bz: bz?.source || null, speed: speed?.source || null },
    tried
  });
}

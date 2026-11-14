// Faili asukoht projektis: /api/sport.js
// BC Pärnu Eesti-Läti liiga tulemused, tabel ja mängukava otse korvpalliliidu (basket.ee) ajakavalehelt.
// Kui basket.ee ei vasta või blokeerib päringu, tagastab { ok:false } ja spordileht kasutab sport/data.json andmeid.

const BASE = 'https://www.basket.ee/et/ajakava-ja-tulemused';
const LEAGUE = 'g23'; // Estonian-Latvian League
const ME = 'BC Pärnu';
const NAMES = { 'BK Liepaja': 'BK Liepāja', 'Rigas Ekselences Juniori': 'Rīgas Ekselences Juniori', 'Transcom Pärnu': ME, 'Pärnu Sadam': ME };
const EST_CLUBS = ['Tartu Ülikool Maks & Moorits', 'TalTech/ALEXELA', 'BC Pärnu', 'Bigbank/Kalev', 'Keila KK', 'Viimsi', 'Keila Basket'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=900');
  try {
    const t = tallinnToday();
    const seasonYear = t.m >= 8 ? t.y : t.y - 1;
    const today = `${pad(t.d)}.${pad(t.m)}.${t.y}`;
    const [resHtml, schHtml] = await Promise.all([
      get(`${BASE}?action=results&chid=${LEAGUE}&start_date=01.08.${seasonYear}&end_date=${today}`),
      get(`${BASE}?action=schedule&chid=${LEAGUE}&team=${encodeURIComponent('Pärnu')}&start_date=${today}&end_date=30.06.${seasonYear + 1}`),
    ]);
    const played = parseGames(resHtml).filter(g => /^\d+:\d+$/.test(g.score));
    if (!played.length) throw new Error('tulemusi ei leitud');
    const upcoming = parseGames(schHtml).filter(g => !/^\d+:\d+$/.test(g.score) && (g.home === ME || g.away === ME));

    // Tabel
    const st = {};
    const row = n => (st[n] = st[n] || { w: 0, l: 0, pf: 0, pa: 0 });
    for (const g of played) {
      const [x, y] = g.score.split(':').map(Number);
      const h = row(g.home), a = row(g.away);
      h.pf += x; h.pa += y; a.pf += y; a.pa += x;
      if (x > y) { h.w++; a.l++; } else { a.w++; h.l++; }
    }
    const pct = v => v.w / (v.w + v.l);
    const sorted = Object.entries(st).sort((p, q) => pct(q[1]) - pct(p[1]) || (q[1].pf - q[1].pa) - (p[1].pf - p[1].pa));
    const fmtPct = v => pct(v).toFixed(3).replace(/^0/, '');
    const fmtDiff = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
    const table = sorted.map(([n, v], i) => [i + 1, n, v.w + v.l, v.w, v.l, fmtPct(v), fmtDiff(v.pf - v.pa)]);
    const kml = sorted.filter(([n]) => EST_CLUBS.includes(n)).map(([n, v], i) => [i + 1, n, v.w + v.l, v.w, v.l, fmtPct(v)]);

    // BC Pärnu mängud
    const mine = played.filter(g => g.home === ME || g.away === ME).sort((a, b) => a.sort.localeCompare(b.sort));
    const results = mine.map(g => {
      const [x, y] = g.score.split(':').map(Number);
      const home = g.home === ME;
      return { date: g.date, time: g.time, title: `${g.home} – ${g.away}`, score: g.score, result: (home ? x > y : y > x) ? 'W' : 'L', place: g.place, home };
    });
    const cnt = (arr, r) => arr.filter(g => g.result === r).length;
    const homeG = results.filter(g => g.home), awayG = results.filter(g => !g.home);
    let streak = 0;
    for (let i = results.length - 1; i >= 0 && results[i].result === results[results.length - 1].result; i--) streak++;
    const me = st[ME] || { w: 0, l: 0, pf: 0, pa: 0 };
    const n = me.w + me.l || 1;
    const pos = (table.find(r => r[1] === ME) || [null])[0];

    res.status(200).json({
      ok: true,
      source: 'basket.ee',
      updated: new Date().toISOString(),
      games: played.length,
      table,
      kml,
      results,
      upcoming: upcoming.sort((a, b) => a.sort.localeCompare(b.sort)).map(g => ({ date: g.date, time: g.time, title: `${g.home} – ${g.away}`, place: g.place, tv: g.tv })),
      summary: {
        pos, w: me.w, l: me.l,
        home: [cnt(homeG, 'W'), cnt(homeG, 'L')],
        away: [cnt(awayG, 'W'), cnt(awayG, 'L')],
        ppg: +(me.pf / n).toFixed(1), oppg: +(me.pa / n).toFixed(1),
        streak, streakType: results.length ? results[results.length - 1].result : null,
      },
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}

async function get(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'et-EE,et;q=0.9,en;q=0.5',
    },
  });
  if (!r.ok) throw new Error('basket.ee vastas ' + r.status);
  const html = await r.text();
  if (html.includes('turnstile-guard-form')) throw new Error('basket.ee turvakontroll');
  return html;
}

function parseGames(html) {
  const out = [];
  for (const chunk of html.split('<tr').slice(1)) {
    const d = chunk.match(/class="dateAndTime">\s*[^\d<]*(\d\d)\.(\d\d)\.(\d{4})(?:,\s*(\d\d:\d\d))?/);
    const h = chunk.match(/homeTeamNameDesktop">([^<]+)</);
    const a = chunk.match(/visitorTeamNameDesktop">([^<]+)</);
    if (!d || !h || !a) continue;
    const sc = chunk.match(/class="center result">\s*([^<]*?)\s*</);
    const ar = chunk.match(/class="arena">\s*([^<]*?)\s*</);
    const bc = chunk.split('class="center broadcast"')[1] || '';
    const tv = [...new Set([...bc.matchAll(/title="([^"]+)"/g)].map(m => dec(m[1])))];
    const date = `${d[3]}-${d[2]}-${d[1]}`;
    out.push({
      date, time: d[4] || null, sort: `${date}T${d[4] || '00:00'}`,
      home: name(h[1]), away: name(a[1]),
      score: sc ? sc[1].replace(/\s+/g, '') : '',
      place: ar ? dec(ar[1]) : '',
      tv: tv.join(', '),
    });
  }
  return out;
}

function dec(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}
function name(s) { const n = dec(s); return NAMES[n] || n; }
function pad(n) { return String(n).padStart(2, '0'); }
function tallinnToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = k => +p.find(x => x.type === k).value;
  return { y: v('year'), m: v('month'), d: v('day') };
}

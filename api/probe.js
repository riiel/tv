// Ajutine kontroll: kas Verceli server saab spordiallikad kätte. Kustutatakse pärast seadistamist.
const ALLOWED = ['www.fiba.basketball', 'jalgpall.ee', 'www.basket.ee'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const u = new URL(String(req.query.u || ''));
    if (u.protocol !== 'https:' || !ALLOWED.includes(u.hostname)) return res.status(400).json({ ok: false, error: 'host' });
    const t0 = Date.now();
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'et-EE,et;q=0.9,en;q=0.5',
      },
    });
    const html = await r.text();
    const find = String(req.query.find || '');
    const i = find ? html.indexOf(find) : -1;
    const from = req.query.from ? +req.query.from : Math.max(0, i - 300);
    const len = Math.min(+req.query.len || 600, 60000);
    res.status(200).json({
      ok: true, status: r.status, ms: Date.now() - t0, length: html.length, index: i,
      count: find ? html.split(find).length - 1 : 0,
      text: (find || req.query.from) ? html.slice(from, from + len) : html.slice(0, 300),
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}

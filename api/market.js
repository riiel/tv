export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 1. Kui kasutaja otsib trükkides aktsiat/fondi (?q=...)
  if (req.query.q) {
    const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(req.query.q)}&quotesCount=8`;
    try {
      const r = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await r.json();
      return res.status(200).json({ quotes: data?.quotes || [] });
    } catch (err) {
      return res.status(200).json({ quotes: [] });
    }
  }

  // 2. Kui päritakse konkreetse sümboli hinda (?symbol=...)
  const symbol = (req.query.symbol || 'VUAA.DE').trim();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('Andmed puuduvad');

    let price = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose || meta.previousClose || price);
    const change = prev ? ((price - prev) / prev) * 100 : 0;

    if (meta.currency === 'USD') {
      price = price * 0.92;
    }

    res.status(200).json({ symbol, price, change, currency: meta.currency });
  } catch (error) {
    res.status(500).json({ error: 'Börsipäring ebaõnnestus' });
  }
}

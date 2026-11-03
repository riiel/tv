export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const symbol = (req.query.symbol || 'SXR8.DE').trim();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('Andmed puuduvad');

    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose || meta.previousClose || price;
    const change = prev ? ((price - prev) / prev) * 100 : 0;

    res.status(200).json({ symbol, price, change });
  } catch (error) {
    res.status(500).json({ error: 'Börsipäring ebaõnnestus' });
  }
}

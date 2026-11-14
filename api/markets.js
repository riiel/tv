// Turuinfo alumise riba jaoks: krüpto, indeksid, kuld, nafta, valuuta.
// Peamine allikas Yahoo Finance (mitteametlik chart-API), varuallikad CoinGecko (krüpto) ja Frankfurter/EKP (EUR/USD).
// Vastus: { items: [{ id, label, price, change, currency, time, source }], tried: [...] }

const ITEMS = [
  { id: 'btc',    label: 'Bitcoin',  yahoo: 'BTC-EUR',  gecko: 'bitcoin' },
  { id: 'eth',    label: 'Ethereum', yahoo: 'ETH-EUR',  gecko: 'ethereum' },
  { id: 'nasdaq', label: 'Nasdaq',   yahoo: '^IXIC' },
  { id: 'sp500',  label: 'S&P 500',  yahoo: '^GSPC' },
  { id: 'gold',   label: 'Kuld',     yahoo: 'GC=F' },
  { id: 'brent',  label: 'Brent',    yahoo: 'BZ=F' },
  { id: 'eurusd', label: 'EUR/USD',  yahoo: 'EURUSD=X', frankfurter: true }
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getJson(url, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fromYahoo(sym) {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
  const m = d?.chart?.result?.[0]?.meta;
  const price = num(m?.regularMarketPrice);
  const prev = num(m?.chartPreviousClose) ?? num(m?.previousClose);
  if (price === null) throw new Error('hind puudub');
  return {
    price,
    change: prev ? (price / prev - 1) * 100 : null,
    currency: m.currency || null,
    time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  const tried = [];

  // Varuallikad ette (üks päring kõigile krüptodele)
  const geckoIds = ITEMS.filter(i => i.gecko).map(i => i.gecko).join(',');
  const geckoP = getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds}&vs_currencies=eur&include_24hr_change=true`)
    .catch(e => { tried.push({ src: 'coingecko', error: String(e.message || e) }); return null; });

  const items = await Promise.all(ITEMS.map(async it => {
    const base = { id: it.id, label: it.label };
    try {
      return { ...base, ...(await fromYahoo(it.yahoo)), source: 'yahoo' };
    } catch (e) {
      tried.push({ src: `yahoo ${it.yahoo}`, error: String(e.name === 'AbortError' ? 'timeout' : (e.message || e)) });
    }
    if (it.gecko) {
      const g = (await geckoP)?.[it.gecko];
      if (num(g?.eur) !== null) return { ...base, price: g.eur, change: num(g.eur_24h_change), currency: 'EUR', time: null, source: 'coingecko' };
    }
    if (it.frankfurter) {
      try {
        const f = await getJson('https://api.frankfurter.app/latest?from=EUR&to=USD');
        if (num(f?.rates?.USD) !== null) return { ...base, price: f.rates.USD, change: null, currency: 'USD', time: f.date || null, source: 'ecb' };
      } catch (e) { tried.push({ src: 'frankfurter', error: String(e.message || e) }); }
    }
    return { ...base, price: null, change: null, currency: null, time: null, source: null };
  }));

  res.status(200).json({ items, tried });
}

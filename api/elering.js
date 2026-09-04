export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const query = new URLSearchParams(req.query).toString();
  const url = `https://dashboard.elering.ee/api/nps/price?${query}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Eleringi päring ebaõnnestus' });
  }
}

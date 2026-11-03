export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const streamUrl = req.query.url;
  if (!streamUrl) return res.status(400).json({ title: '' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(streamUrl, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18'
      },
      signal: controller.signal
    });

    const metaintHeader = response.headers.get('icy-metaint');
    if (!metaintHeader || !response.body) {
      clearTimeout(timeout);
      return res.status(200).json({ title: '' });
    }

    const metaint = parseInt(metaintHeader, 10);
    const reader = response.body.getReader();
    let buffer = new Uint8Array(0);

    while (buffer.length < metaint + 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;

      if (buffer.length > metaint) {
        const metaLen = buffer[metaint] * 16;
        if (metaLen === 0) break;
        if (buffer.length >= metaint + 1 + metaLen) {
          const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
          const metaText = new TextDecoder('utf-8').decode(metaBytes);
          const match = metaText.match(/StreamTitle='([^']*)'/i);
          await reader.cancel();
          clearTimeout(timeout);
          return res.status(200).json({ title: match ? match[1].trim() : '' });
        }
      }
    }

    await reader.cancel();
    clearTimeout(timeout);
    return res.status(200).json({ title: '' });
  } catch (err) {
    clearTimeout(timeout);
    return res.status(200).json({ title: '' });
  }
}

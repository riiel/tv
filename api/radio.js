// Tagastab hetkel mängiva loo: { title: "Artist - Lugu" }
// 1) StreamTheWorld/Triton jaamad (WKNDMX, Q-Dance): Triton "now playing" API
// 2) kõik muu: ICY-metaandmed otse striimist (loeb mitu metaplokki, sest esimene on sageli tühi)

const TRITON_MOUNT = /^https?:\/\/[^/]*streamtheworld\.com\/([A-Za-z0-9_]+?)(?:_SC)?(?:\.(?:aac|mp3))?(?:[?#]|$)/i;

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();
}

async function tritonTitle(mount, signal) {
  const url = `https://np.tritondigital.com/public/nowplaying?mountName=${encodeURIComponent(mount)}&numberToFetch=1&eventType=track`;
  const r = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return '';
  const xml = await r.text();
  const prop = name => {
    const m = xml.match(new RegExp(`<property name="${name}"[^>]*>([\\s\\S]*?)</property>`, 'i'));
    return m ? decodeXml(m[1]) : '';
  };
  const artist = prop('track_artist_name');
  const title = prop('cue_title');
  if (artist && title) return `${artist} - ${title}`;
  return title || '';
}

async function icyTitle(streamUrl, signal) {
  const response = await fetch(streamUrl, {
    headers: { 'Icy-MetaData': '1', 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' },
    signal
  });
  const metaint = parseInt(response.headers.get('icy-metaint') || '', 10);
  if (!metaint || !response.body) {
    try { await response.body?.cancel(); } catch (e) {}
    return '';
  }

  const reader = response.body.getReader();
  let buf = new Uint8Array(0);
  let offset = 0;          // kus algab järgmine metaplokk
  const MAX_BLOCKS = 6;    // kontrolli kuni 6 metaintervalli (tühjad plokid jäetakse vahele)

  try {
    for (let block = 0; block < MAX_BLOCKS; block++) {
      // oota, kuni metaploki pikkusbait on olemas
      while (buf.length < offset + metaint + 1) {
        const { done, value } = await reader.read();
        if (done) return '';
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf); next.set(value, buf.length);
        buf = next;
      }
      const metaLen = buf[offset + metaint] * 16;
      const start = offset + metaint + 1;
      if (metaLen > 0) {
        while (buf.length < start + metaLen) {
          const { done, value } = await reader.read();
          if (done) return '';
          const next = new Uint8Array(buf.length + value.length);
          next.set(buf); next.set(value, buf.length);
          buf = next;
        }
        const text = new TextDecoder('utf-8').decode(buf.slice(start, start + metaLen));
        const m = text.match(/StreamTitle='((?:[^']|'(?!;))*)'/i);
        const title = m ? m[1].trim() : '';
        if (title) return title;
      }
      offset = start + metaLen;   // liigu järgmise intervalli juurde
    }
    return '';
  } finally {
    try { await reader.cancel(); } catch (e) {}
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const streamUrl = req.query.url;
  if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) return res.status(400).json({ title: '' });

  // Diagnostika: /api/radio?url=...&debug=1 näitab, mida jaama server tegelikult vastab
  if (req.query.debug) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    try {
      const r = await fetch(streamUrl, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' }, signal: c.signal });
      const headers = {};
      r.headers.forEach((v, k) => { if (/^(icy-|content-type|server|x-)/i.test(k)) headers[k] = v; });
      try { await r.body?.cancel(); } catch (e) {}
      return res.status(200).json({ status: r.status, headers });
    } catch (e) {
      const c0 = e && e.cause;
      return res.status(200).json({ error: String(e && e.message || e), cause: c0 ? { code: c0.code, message: c0.message, hostname: c0.hostname } : null });
    } finally { clearTimeout(t); }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let title = '';
    const tw = streamUrl.match(TRITON_MOUNT);
    if (tw) {
      try { title = await tritonTitle(tw[1], controller.signal); } catch (e) {}
    }
    if (!title) {
      try { title = await icyTitle(streamUrl, controller.signal); } catch (e) {}
    }
    return res.status(200).json({ title: title || '' });
  } finally {
    clearTimeout(timeout);
  }
}

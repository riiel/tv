// Tagastab hetkel mängiva loo: { title: "Artist - Lugu" }
// 1) StreamTheWorld/Triton jaamad (WKNDMX, Q-Dance): Triton "now playing" API
// 2) kõik muu: ICY-metaandmed otse striimist (loeb mitu metaplokki, sest esimene on sageli tühi)

import net from 'node:net';
import tls from 'node:tls';

// Avab striimi toore TCP/TLS-ühendusena ja loeb päised ise: Shoutcast-serverid vastavad
// sageli "ICY 200 OK" (mitte HTTP/1.1), mida ei fetch() ega node:http vastu ei võta.
// Tagastab { status, headers, read(), destroy() }; read() annab järgmise Bufferi või null.
function openStream(url, signal, redirects = 3) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const secure = u.protocol === 'https:';
    const port = Number(u.port) || (secure ? 443 : 80);
    const socket = secure
      ? tls.connect({ host: u.hostname, port, servername: u.hostname })
      : net.connect({ host: u.hostname, port });

    const chunks = [];
    let waiter = null, ended = false, failure = null, settled = false;
    let head = Buffer.alloc(0);

    const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
    const fail = err => {
      failure = err; ended = true; wake();
      if (!settled) { settled = true; reject(err); }
      socket.destroy();
    };
    const destroy = () => { try { socket.destroy(); } catch (e) {} };

    if (signal) {
      if (signal.aborted) return fail(new Error('aborted'));
      signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true });
    }

    socket.setNoDelay(true);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.write(`GET ${u.pathname || '/'}${u.search} HTTP/1.0\r\nHost: ${u.host}\r\n` +
        `User-Agent: VLC/3.0.18 LibVLC/3.0.18\r\nIcy-MetaData: 1\r\nAccept: */*\r\nConnection: close\r\n\r\n`);
    });
    socket.on('error', fail);
    socket.on('end', () => { ended = true; wake(); if (!settled) fail(new Error('connection closed before headers')); });
    socket.on('close', () => { ended = true; wake(); });

    socket.on('data', data => {
      if (settled) { chunks.push(data); wake(); return; }
      head = Buffer.concat([head, data]);
      let end = head.indexOf('\r\n\r\n'), sep = 4;
      if (end < 0) { end = head.indexOf('\n\n'); sep = 2; }
      if (end < 0) { if (head.length > 16384) fail(new Error('headers too large')); return; }

      const lines = head.subarray(0, end).toString('latin1').split(/\r?\n/);
      const rest = head.subarray(end + sep);
      const m = (lines[0] || '').match(/^(?:HTTP\/[\d.]+|ICY)\s+(\d{3})/i);
      if (!m) return fail(new Error(`unexpected response: ${(lines[0] || '').slice(0, 60)}`));
      const status = Number(m[1]);
      const headers = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      settled = true;
      if (rest.length) chunks.push(rest);

      if (status >= 300 && status < 400 && headers.location && redirects > 0) {
        destroy();
        return resolve(openStream(new URL(headers.location, url).toString(), signal, redirects - 1));
      }
      resolve({
        status, headers, destroy,
        read: async () => {
          while (!chunks.length) {
            if (failure) throw failure;
            if (ended) return null;
            await new Promise(r => { waiter = r; });
          }
          return chunks.shift();
        }
      });
    });
  });
}

// Sunshine Live kanalid saadavad striimis ainult kanali nime. Lood tulevad nende kodulehe API-st (loverad.io).
// Võti = kanali nimi striimi aadressis (stream.sunshine-live.de/<NIMI>/...), väärtus = loverad station number.
// Numbri leiad sunshine-live.de kanali lehelt: F12 → Network → flow.json?station=<NUMBER>
const SUNSHINE_STATIONS = {
  hardcore: 91,     // Sunshine Live Hardcore (kontrolli /api/radio?sunshine=list abil)
  dnb: null         // TÄIDA: Drum 'n' Bass number (71 osutus Classics kanaliks)
};

async function sunshineTitle(streamUrl, signal) {
  const m = streamUrl.match(/stream\.sunshine-live\.de\/([^/]+)\//i);
  if (!m) return '';
  const id = SUNSHINE_STATIONS[m[1].toLowerCase()];
  if (!id) return '';
  const r = await fetch(`https://iris-sunshinelive.loverad.io/flow.json?station=${id}&offset=1&count=1`, {
    signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
  });
  if (!r.ok) return '';
  const d = await r.json();
  const entry = d?.result?.entry?.[0];
  // Kui viimane teadaolev lugu on ammu lõppenud (nt reklaam, saade), ära näita vana nime
  const start = Date.parse(entry?.airtime || '');
  const dur = Number(entry?.duration) || 0;
  if (Number.isFinite(start) && dur > 0 && Date.now() > start + (dur + 180) * 1000) return '';
  const song = entry?.song?.entry?.[0];
  const title = String(song?.title || '').trim();
  const artists = (song?.artist?.entry || []).map(a => a?.name).filter(Boolean).join(', ');
  return title ? (artists ? `${artists} - ${title}` : title) : '';
}

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
  const stream = await openStream(streamUrl, signal);
  const { headers } = stream;
  const metaint = parseInt(headers['icy-metaint'] || '', 10);
  if (!metaint) { stream.destroy(); return ''; }

  let buf = Buffer.alloc(0);
  let offset = 0;          // kus algab järgmine metaplokk
  const MAX_BLOCKS = 6;    // kontrolli kuni 6 metaintervalli (tühjad plokid jäetakse vahele)
  const need = async n => {
    while (buf.length < n) {
      const value = await stream.read();
      if (!value) return false;
      buf = Buffer.concat([buf, value]);
    }
    return true;
  };

  try {
    for (let block = 0; block < MAX_BLOCKS; block++) {
      if (!(await need(offset + metaint + 1))) return '';
      const metaLen = buf[offset + metaint] * 16;
      const start = offset + metaint + 1;
      if (metaLen > 0) {
        if (!(await need(start + metaLen))) return '';
        const text = buf.subarray(start, start + metaLen).toString('utf8');
        const m = text.match(/StreamTitle='((?:[^']|'(?!;))*)'/i);
        const title = m ? m[1].trim() : '';
        if (title) return title;
      }
      offset = start + metaLen;
    }
    return '';
  } finally {
    stream.destroy();
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  // Abi: /api/radio?sunshine=list näitab kõigi Sunshine Live kanalite praegust lugu (station number: lugu)
  if (req.query.sunshine === 'list') {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const rows = await Promise.all(ids.map(async id => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 6000);
      try {
        const r = await fetch(`https://iris-sunshinelive.loverad.io/flow.json?station=${id}&offset=1&count=1`, { signal: c.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) return null;
        const e = (await r.json())?.result?.entry?.[0];
        const song = e?.song?.entry?.[0];
        if (!song?.title) return null;
        const artist = (song.artist?.entry || []).map(a => a?.name).filter(Boolean).join(', ');
        const at = e.airtime ? new Date(e.airtime).toLocaleTimeString('et-EE', { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit' }) : '';
        return `${String(id).padStart(3)}: ${artist ? artist + ' - ' : ''}${song.title}${at ? '   (algas ' + at + ')' : ''}`;
      } catch (e) { return null; } finally { clearTimeout(t); }
    }));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(['Sunshine Live kanalid: station number: praegune lugu', '', ...rows.filter(Boolean)].join('\n'));
  }

  const streamUrl = req.query.url;
  if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) return res.status(400).json({ title: '' });

  // Diagnostika: /api/radio?url=...&debug=1 näitab, mida jaama server tegelikult vastab
  if (req.query.debug) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    try {
      const { status, headers, destroy } = await openStream(streamUrl, c.signal);
      destroy();
      const out = {};
      for (const [k, v] of Object.entries(headers)) if (/^(icy-|content-type|server|x-)/i.test(k)) out[k] = v;
      return res.status(200).json({ status, headers: out });
    } catch (e) {
      const c0 = e && e.cause;
      return res.status(200).json({ error: String(e && e.message || e), cause: c0 ? { code: c0.code, message: c0.message } : (e && e.code ? { code: e.code } : null) });
    } finally { clearTimeout(t); }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let title = '';
    if (/sunshine-live\.de/i.test(streamUrl)) {
      try { title = await sunshineTitle(streamUrl, controller.signal); } catch (e) {}
    }
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

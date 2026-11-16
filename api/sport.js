// Faili asukoht projektis: /api/sport.js
// Spordilehe (/sport/) otseandmed. Kõik loetakse otse alaliitude avalikelt lehtedelt, ilma Claude'i abita:
//   - basket.ee        BC Pärnu Eesti-Läti liiga (tabel, tulemused, kava, ülekanded) ja korvpallikoondise kava
//   - fiba.basketball  FIBA Europe Cup (BC Pärnu) ja MM-valiksari (Eesti koondis)
//   - jalgpall.ee      Pärnu JK Vaprus (Premium liiga, karikas) ja Eesti jalgpallikoondis
//   - wikipedia.org    Ralli MM (WRC): sõitjate ja tootjate tabel, Ott Tänaku kohad ja etappide võitjad
// Iga allikas on eraldi: kui üks ei vasta, tulevad teised ikka ja leht kasutab puuduva osa jaoks faili sport/data.json.

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'et-EE,et;q=0.9,en;q=0.5',
};
const ME = 'BC Pärnu';

export default async function handler(req, res) {
  const t = tallinnToday();
  const names = ['league', 'ec', 'ekk', 'vap', 'ejk', 'wrc'];
  const settled = await Promise.allSettled([league(t), fibaEC(t), natBasket(t), vaprus(t), koondis(t), wrc(t)]);
  const out = { ok: false, updated: new Date().toISOString(), src: {}, panels: {}, summaries: {}, eventSets: [], logos: {} };
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      out.src[names[i]] = true;
      Object.assign(out.panels, r.value.panels);
      Object.assign(out.summaries, r.value.summaries);
      Object.assign(out.logos, r.value.logos);
      out.eventSets.push(...(r.value.eventSets || []));
    } else {
      out.src[names[i]] = String((r.reason && r.reason.message) || r.reason || 'viga');
    }
  });
  out.ok = Object.values(out.src).some(v => v === true);
  res.setHeader('Cache-Control', `s-maxage=${cacheSeconds(out)}, stale-while-revalidate=900`);
  res.status(200).json(out);
}

// Mängu ajal ja kohe pärast seda küsitakse allikaid tihedamini, muul ajal harva.
function cacheSeconds(out) {
  if (!out.ok) return 60;
  const now = Date.now();
  let s = 900;
  for (const set of out.eventSets) for (const e of set.events) {
    if (e.score) continue;
    if (e.end) {   // ralli: rallinädalal kontrolli tihedamini
      const a = Date.parse(`${e.date}T00:00:00${tzOff(e.date)}`), b = Date.parse(`${e.end}T23:59:00${tzOff(e.end)}`);
      if (now > a && now < b + 6 * 3600e3) s = 600;
      continue;
    }
    const start = Date.parse(`${e.date}T${e.time || '12:00'}:00${tzOff(e.date)}`);
    if (now > start - 15 * 60e3 && now < start + 4 * 3600e3) return 120;
    if (Math.abs(start - now) < 12 * 3600e3) s = 300;
  }
  return s;
}

// ───────────────────────── BC Pärnu: Eesti-Läti liiga (basket.ee) ─────────────────────────

const BASKET = 'https://www.basket.ee/et/ajakava-ja-tulemused';
const LG = 'Eesti-Läti liiga';
const BASKET_NAMES = { 'BK Liepaja': 'BK Liepāja', 'Rigas Ekselences Juniori': 'Rīgas Ekselences Juniori', 'Transcom Pärnu': ME, 'Pärnu Sadam': ME };
const EST_CLUBS = ['Tartu Ülikool Maks & Moorits', 'TalTech/ALEXELA', 'BC Pärnu', 'Bigbank/Kalev', 'Keila KK', 'Viimsi', 'Keila Basket'];

async function league(t) {
  const seasonYear = t.m >= 8 ? t.y : t.y - 1;
  const today = `${pad(t.d)}.${pad(t.m)}.${t.y}`;
  const [resHtml, schHtml] = await Promise.all([
    getBasket(`${BASKET}?action=results&chid=g23&start_date=01.08.${seasonYear}&end_date=${today}`),
    getBasket(`${BASKET}?action=schedule&chid=g23&team=${encodeURIComponent('Pärnu')}&start_date=${today}&end_date=30.06.${seasonYear + 1}`),
  ]);
  const played = parseBasket(resHtml).filter(g => /^\d+:\d+$/.test(g.score));
  if (!played.length) throw new Error('basket.ee: tulemusi ei leitud');
  const upcoming = parseBasket(schHtml).filter(g => !/^\d+:\d+$/.test(g.score) && (g.home === ME || g.away === ME)).sort(bySort);

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
  const table = sorted.map(([n, v], i) => [i + 1, n, v.w + v.l, v.w, v.l, fmtPct(v), signed(v.pf - v.pa)]);
  const kml = sorted.filter(([n]) => EST_CLUBS.includes(n)).map(([n, v], i) => [i + 1, n, v.w + v.l, v.w, v.l, fmtPct(v)]);

  const mine = played.filter(g => g.home === ME || g.away === ME).sort(bySort).map(g => {
    const [x, y] = g.score.split(':').map(Number);
    const home = g.home === ME;
    return { ...g, isHome: home, result: (home ? x > y : y > x) ? 'W' : 'L' };
  });
  const cnt = (arr, r) => arr.filter(g => g.result === r).length;
  const homeG = mine.filter(g => g.isHome), awayG = mine.filter(g => !g.isHome);
  let streak = 0;
  for (let i = mine.length - 1; i >= 0 && mine[i].result === mine[mine.length - 1].result; i--) streak++;
  const me = st[ME] || { w: 0, l: 0, pf: 0, pa: 0 };
  const n = me.w + me.l || 1;
  const pos = (table.find(r => r[1] === ME) || [null])[0];
  const c1 = x => x.toFixed(1).replace('.', ',');

  const panels = {
    'lg-table': { columns: ['#', 'Meeskond', 'M', 'V', 'K', '%', '+/−'], rows: table },
    'lg-kml': { columns: ['#', 'Meeskond', 'M', 'V', 'K', '%'], rows: kml },
    'lg-results': { items: mine.map(g => ({ date: dm(g.date), title: `${g.home} – ${g.away}`, note: g.place, score: g.score, result: g.result })) },
  };
  if (mine.length) panels['lg-stats'] = { items: [
    [`${me.w}–${me.l}`, 'võidud–kaotused'],
    [`${cnt(homeG, 'W')}–${cnt(homeG, 'L')}`, 'kodus'],
    [`${cnt(awayG, 'W')}–${cnt(awayG, 'L')}`, 'võõrsil'],
    [c1(me.pf / n), 'visatud punkte mängus'],
    [c1(me.pa / n), 'lastud punkte mängus'],
    [String(streak), mine[mine.length - 1].result === 'W' ? 'võitu järjest' : 'kaotust järjest'],
  ] };
  const events = mine.map(g => ({ team: 'bcp', date: g.date, time: g.time, title: `${g.home} – ${g.away}`, comp: LG, place: g.place, score: g.score, result: g.result }))
    .concat(upcoming.map(g => ({ team: 'bcp', date: g.date, time: g.time, title: `${g.home} – ${g.away}`, comp: LG, place: g.place, tv: g.tv })));
  return {
    panels,
    summaries: pos ? { bcp: { headline: `${pos}. koht`, sub: `${me.w} V · ${me.l} K` } } : {},
    eventSets: [{ team: 'bcp', re: '^Eesti-Läti liiga$', events }],
  };
}

async function getBasket(url) {
  const html = await get(url);
  if (html.includes('turnstile-guard-form')) throw new Error('basket.ee turvakontroll');
  return html;
}

function parseBasket(html) {
  const out = [];
  for (const chunk of html.split('<tr').slice(1)) {
    const d = chunk.match(/class="dateAndTime">\s*[^\d<]*(\d\d)\.(\d\d)\.(\d{4})(?:,\s*(\d\d:\d\d))?/);
    const h = chunk.match(/homeTeamNameDesktop">([^<]+)</);
    const a = chunk.match(/visitorTeamNameDesktop">([^<]+)</);
    if (!d || !h || !a) continue;
    const sc = chunk.match(/class="center result">\s*([^<]*?)\s*</);
    const ar = chunk.match(/class="arena">\s*([^<]*?)\s*</);
    const cp = chunk.match(/class="competition">\s*([^<]*?)\s*</);
    const bc = chunk.split('class="center broadcast"')[1] || '';
    const tv = [...new Set([...bc.matchAll(/title="([^"]+)"/g)].map(m => dec(m[1])))];
    const date = `${d[3]}-${d[2]}-${d[1]}`;
    const nm = s => { const x = dec(s); return BASKET_NAMES[x] || x; };
    out.push({
      date, time: d[4] || null, sort: `${date}T${d[4] || '00:00'}`,
      home: nm(h[1]), away: nm(a[1]),
      score: sc ? sc[1].replace(/\s+/g, '') : '',
      place: ar ? dec(ar[1]) : '',
      comp: cp ? dec(cp[1]) : '',
      tv: tv.join(', '),
    });
  }
  return out;
}

// ───────────────────────── FIBA (fiba.basketball) ─────────────────────────

const FIBA = 'https://www.fiba.basketball/en/events/';
const PARNU_ORG = 58616;
const CLUBS = { 58616: ME, 1129: 'SLUC Nancy', 66528: 'King Szczecin', 729: 'Keravnos', 73436: 'BC Vienna', 89491: 'Nitra Blue Wings', 81526: 'Neftçi', 2710: 'Tartu Ülikool Maks & Moorits', 8015: 'Bigbank/Kalev' };
const PLAYER_FIX = { 'Klavs Dubults': 'Klāvs Dubults', 'Renars Birkans': 'Renārs Birkāns', 'Hendrik Eelmae': 'Hendrik Eelmäe', 'Illya Sydorov': 'Illja Sidorov' };
const CITY = { Vienna: 'Viin', Nicosia: 'Nikosia', Baku: 'Bakuu', Warsaw: 'Varssavi', Prague: 'Praha', Athens: 'Ateena', Brussels: 'Brüssel', Lisbon: 'Lissabon', Bucharest: 'Bukarest', Copenhagen: 'Kopenhaagen', Rome: 'Rooma', Belgrade: 'Belgrad', Cologne: 'Köln', Munich: 'München', Geneva: 'Genf', Riga: 'Riia', Helsinki: 'Helsingi', Stockholm: 'Stockholm' };
// FIBA riigikood → [eestikeelne nimi, lipu kood]
const COUNTRY = {
  EST: ['Eesti', 'ee'], FRA: ['Prantsusmaa', 'fr'], FIN: ['Soome', 'fi'], SLO: ['Sloveenia', 'si'], SWE: ['Rootsi', 'se'], HUN: ['Ungari', 'hu'],
  CZE: ['Tšehhi', 'cz'], LAT: ['Läti', 'lv'], LTU: ['Leedu', 'lt'], GER: ['Saksamaa', 'de'], ESP: ['Hispaania', 'es'], ITA: ['Itaalia', 'it'],
  SRB: ['Serbia', 'rs'], CRO: ['Horvaatia', 'hr'], POL: ['Poola', 'pl'], GRE: ['Kreeka', 'gr'], TUR: ['Türgi', 'tr'], ISR: ['Iisrael', 'il'],
  UKR: ['Ukraina', 'ua'], GEO: ['Gruusia', 'ge'], POR: ['Portugal', 'pt'], MNE: ['Montenegro', 'me'], BIH: ['Bosnia ja Hertsegoviina', 'ba'],
  ISL: ['Island', 'is'], NED: ['Holland', 'nl'], BEL: ['Belgia', 'be'], DEN: ['Taani', 'dk'], NOR: ['Norra', 'no'], GBR: ['Suurbritannia', 'gb'],
  SUI: ['Šveits', 'ch'], AUT: ['Austria', 'at'], BUL: ['Bulgaaria', 'bg'], ROU: ['Rumeenia', 'ro'], MKD: ['Põhja-Makedoonia', 'mk'],
  SVK: ['Slovakkia', 'sk'], CYP: ['Küpros', 'cy'], KOS: ['Kosovo', 'xk'], IRL: ['Iirimaa', 'ie'], LUX: ['Luksemburg', 'lu'], ARM: ['Armeenia', 'am'],
  AZE: ['Aserbaidžaan', 'az'], ALB: ['Albaania', 'al'], USA: ['USA', 'us'],
};
// Eestikeelne riiginimi → lipu kood (jalgpall.ee ja basket.ee kasutavad eestikeelseid nimesid)
const FLAGS = Object.fromEntries(Object.values(COUNTRY).map(([n, c]) => [n, c]));
Object.assign(FLAGS, { 'Fääri saared': 'fo', Malta: 'mt', 'San Marino': 'sm', Andorra: 'ad', Gibraltar: 'gi', Liechtenstein: 'li', Moldova: 'md', Kasahstan: 'kz', Valgevene: 'by', Wales: 'gb-wls', Šotimaa: 'gb-sct', Inglismaa: 'gb-eng', 'Põhja-Iirimaa': 'gb-nir', Venemaa: 'ru', 'Põhja-Makedoonia': 'mk', Madalmaad: 'nl' });

// Next.js lehe sisse kirjutatud andmed (self.__next_f) üheks tekstiks
function flight(html) {
  let s = '';
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { s += JSON.parse(m[1]); } catch (_) { /* vigane tükk jääb vahele */ } }
  return s;
}
// Kõik JSON-massiivid, mis järgnevad võtmele (nt '"games":[')
function arraysAfter(s, key) {
  const out = [];
  let from = 0;
  for (;;) {
    const k = s.indexOf(key, from);
    if (k < 0) break;
    const i = k + key.length - 1;
    let d = 0, inS = false, esc = false, j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inS = false; }
      else if (c === '"') inS = true;
      else if (c === '[' || c === '{') d++;
      else if (c === ']' || c === '}') { d--; if (d === 0) break; }
    }
    try { const v = JSON.parse(s.slice(i, j + 1)); if (Array.isArray(v)) out.push(v); } catch (_) { /* jätame vahele */ }
    from = j;
  }
  return out;
}
const longest = arrs => arrs.sort((a, b) => b.length - a.length)[0] || [];
function fibaGames(html) {
  return longest(arraysAfter(flight(html), '"games":[')).filter(g => g && g.teamA && g.teamB && g.gameDateTimeUTC);
}
// Ametlik alagrupitabel lehe HTML-ist: tabel, kus on link antud meeskonnale
function fibaTable(html, slug) {
  for (const t of html.split('<table').slice(1)) {
    const body = t.split('</table>')[0];
    if (!body.includes(`/teams/${slug}"`)) continue;
    const rows = body.split('<tr').slice(1)
      .map(r => r.replace(/<!-- -->/g, '').split(/<td[^>]*>/).slice(1).map(c => c.replace(/<[^>]+>/g, '').trim()))
      .filter(c => c.length >= 4 && /^\d+\/\d+$/.test(c[2]));
    if (rows.length) return rows.map(c => {
      const [w, l] = c[2].split('/').map(Number);
      return { pos: parseInt(c[0], 10), code: c[1].replace(/\s*\(.*$/, ''), w, l, pts: Number(c[3]) };
    });
  }
  return null;
}
function fibaWhen(g) {
  const d = new Date(g.gameDateTimeUTC + 'Z');
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const [date, time] = p.split(' ');
  return { date, time: g.hasTimeGameDateTime ? time.slice(0, 5) : null };
}
const fibaDone = g => !g.isLive && (g.teamAScore + g.teamBScore > 0) && (g.statusCode === 'VALID' || g.liveGameStatus === 999);
const city = c => CITY[c] || c || '';

async function fibaEC(t) {
  const y = (t.m >= 8 ? t.y : t.y - 1) % 100;
  const slug = `fiba-europe-cup-${pad(y)}-${pad(y + 1)}`;
  const [html, teamHtml] = await Promise.all([
    get(`${FIBA}${slug}/standings`, 9000),
    get(`${FIBA}${slug}/teams/bc-parnu`, 9000).catch(() => ''),
  ]);
  const games = fibaGames(html);
  const isMe = x => x.organisationId === PARNU_ORG;
  const mine = games.filter(g => isMe(g.teamA) || isMe(g.teamB)).sort((a, b) => a.gameDateTimeUTC.localeCompare(b.gameDateTimeUTC));
  if (!mine.length) throw new Error('FIBA: BC Pärnu mänge ei leitud');
  const club = x => CLUBS[x.organisationId] || x.shortName || x.officialName;
  const ROUND = { Q: 'eelring', RS: 'alagrupp', SR: '2. ring', QF: 'veerandfinaal', SF: 'poolfinaal', F: 'finaal' };
  const logos = {};
  const compId = mine[0].competition && mine[0].competition.competitionId;

  const events = mine.map(g => {
    const w = fibaWhen(g), home = isMe(g.teamA), rc = g.round && g.round.roundCode;
    for (const x of [g.teamA, g.teamB]) if (compId) logos[club(x)] = `https://assets.fiba.basketball/image/upload/d_.logoflag--light--organisation_${x.organisationId}.webp/w_200/f_auto/q_auto/.logoflag--light--organisation_${x.organisationId}--competition_${compId}`;
    const e = {
      team: 'bcp', date: w.date, time: w.time, title: `${club(g.teamA)} – ${club(g.teamB)}`,
      comp: 'FIBA Europe Cup' + (rc && rc !== 'RS' && ROUND[rc] ? ` · ${ROUND[rc]}` : ''),
      place: home ? 'Pärnu Spordihall' : [city(g.hostCity), (COUNTRY[g.hostCountryCode] || [g.hostCountry])[0]].filter(Boolean).join(', '),
      _round: ROUND[rc] || '', _city: home ? 'Pärnu' : city(g.hostCity),
    };
    if (fibaDone(g)) { e.score = `${g.teamAScore}:${g.teamBScore}`; e.result = (home ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore) ? 'W' : 'L'; }
    return e;
  });

  const panels = {
    'ec-results': { title: 'Europe Cup tulemused', items: events.filter(e => e.score).map(e => ({ date: dm(e.date), title: e.title, note: cap([e._round, e._city].filter(Boolean).join(', ')), score: e.score, result: e.result })) },
  };

  // Alagrupitabel: viimane alagrupiring, kus BC Pärnu mängib
  const lastGroup = [...mine].reverse().find(g => g.round && g.round.roundType === 'G');
  if (lastGroup) {
    const inGroup = games.filter(g => g.groupId === lastGroup.groupId);
    const byCode = {};
    for (const g of inGroup) for (const x of [g.teamA, g.teamB]) byCode[x.code] = club(x);
    let rows = null;
    const official = fibaTable(html, 'bc-parnu');
    if (official && official.every(r => byCode[r.code])) rows = official.map(r => [r.pos, byCode[r.code], r.w + r.l, r.w, r.l, r.pts]);
    else rows = computeTable(inGroup.filter(fibaDone), club);
    const left = inGroup.filter(g => !fibaDone(g) && (isMe(g.teamA) || isMe(g.teamB))).length;
    const rs = lastGroup.round.roundCode === 'RS';
    panels['ec-table'] = {
      title: `Europe Cup · ${lastGroup.groupPairingCode}-alagrupp`, columns: ['#', 'Meeskond', 'M', 'V', 'K', 'P'], rows, highlight: ME,
      cutAfter: rs ? 2 : null,
      note: (rs ? 'Kaks parimat pääsevad edasi. ' : '') + (left ? `BC Pärnul on jäänud ${left} ${left === 1 ? 'mäng' : 'mängu'}.` : 'Alagrupimängud on mängitud.'),
    };
  }

  // Statistika liidrid meeskonna lehelt
  const stats = teamHtml ? longest(arraysAfter(flight(teamHtml), '"playerInCompetitionTeamStatistics":[')) : [];
  if (stats.length >= 3) {
    const nm = p => { const n = `${p.firstName} ${p.lastName}`.trim(); return PLAYER_FIX[n] || n; };
    const top = k => stats.filter(p => typeof p[k] === 'number').sort((a, b) => b[k] - a[k]).slice(0, 3).map(p => [nm(p), Math.round(p[k] * 10) / 10]);
    panels['ec-leaders'] = { groups: [
      { label: 'Punktid', rows: top('pointsPerGame') },
      { label: 'Lauapallid', rows: top('reboundsPerGame') },
      { label: 'Resultatiivsed söödud', rows: top('assistsPerGame') },
    ] };
  }
  return { panels, logos, eventSets: [{ team: 'bcp', re: '^(FIBA )?Europe Cup', events: events.map(clean) }] };
}

// Tabel mängudest, kui ametlikku tabelit lehelt ei leia (2 p võit, 1 p kaotus)
function computeTable(done, nameOf) {
  const st = {};
  const row = n => (st[n] = st[n] || { w: 0, l: 0, d: 0 });
  for (const g of done) {
    const a = row(nameOf(g.teamA)), b = row(nameOf(g.teamB));
    a.d += g.teamAScore - g.teamBScore; b.d += g.teamBScore - g.teamAScore;
    if (g.teamAScore > g.teamBScore) { a.w++; b.l++; } else { b.w++; a.l++; }
  }
  return Object.entries(st).sort((p, q) => (2 * q[1].w + q[1].l) - (2 * p[1].w + p[1].l) || q[1].d - p[1].d)
    .map(([n, v], i) => [i + 1, n, v.w + v.l, v.w, v.l, 2 * v.w + v.l]);
}

// ───────────────────────── Eesti korvpallikoondis (FIBA + basket.ee) ─────────────────────────

const WCQ = 'fiba-basketball-world-cup-2027-european-qualifiers';
const WC_COMP = 'MM 2027 valiksari';

async function natBasket(t) {
  const today = `${pad(t.d)}.${pad(t.m)}.${t.y}`;
  const seasonYear = t.m >= 8 ? t.y : t.y - 1;
  const [fr, sr, rr] = await Promise.allSettled([
    get(`${FIBA}${WCQ}/standings`, 9000),
    getBasket(`${BASKET}?action=schedule&chid=g12&start_date=${today}&end_date=31.12.${t.y + 1}`),
    getBasket(`${BASKET}?action=results&chid=g12&start_date=01.08.${seasonYear}&end_date=${today}`),
  ]);
  const panels = {}, summaries = {}, logos = {};
  let events = [], fibaOk = false;
  const nat = x => { const c = COUNTRY[x.code]; if (c) logos[c[0]] = `flag:${c[1]}`; return c ? c[0] : x.shortName; };

  if (fr.status === 'fulfilled') {
    const html = fr.value;
    const games = fibaGames(html);
    const isMe = x => x.code === 'EST';
    const mine = games.filter(g => isMe(g.teamA) || isMe(g.teamB)).sort((a, b) => a.gameDateTimeUTC.localeCompare(b.gameDateTimeUTC));
    if (mine.length) {
      fibaOk = true;
      events = mine.map(g => {
        const w = fibaWhen(g), home = isMe(g.teamA);
        const e = { team: 'ekk', date: w.date, time: w.time, title: `${nat(g.teamA)} – ${nat(g.teamB)}`, comp: WC_COMP, place: [g.venueName, city(g.hostCity)].filter(Boolean).join(', '), _round: g.round && g.round.roundCode === 'GR1' ? '1. ring' : '2. ring', _city: city(g.hostCity) };
        if (fibaDone(g)) { e.score = `${g.teamAScore}:${g.teamBScore}`; e.result = (home ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore) ? 'W' : 'L'; }
        return e;
      });
      const last = mine[mine.length - 1];
      const inGroup = games.filter(g => g.groupId === last.groupId);
      const byCode = {};
      for (const g of games) for (const x of [g.teamA, g.teamB]) byCode[x.code] = nat(x);
      const official = fibaTable(html, 'estonia');
      const rows = official && official.every(r => byCode[r.code])
        ? official.map(r => [r.pos, byCode[r.code], r.w + r.l, r.w, r.l, r.pts])
        : computeTable(inGroup.filter(fibaDone), nat);
      const left = inGroup.filter(g => !fibaDone(g) && (isMe(g.teamA) || isMe(g.teamB))).length;
      const gr2 = last.round && last.round.roundCode === 'GR2';
      panels['ekk-table'] = {
        title: `MM-valiksari · ${last.groupPairingCode}-alagrupp`, columns: ['#', 'Koondis', 'M', 'V', 'K', 'P'], rows, highlight: 'Eesti',
        cutAfter: gr2 ? 3 : null,
        note: (gr2 ? 'Kolm paremat pääsevad 2027. aasta MM-ile Katari. ' : '') + (left ? `Eestil on jäänud ${left} ${left === 1 ? 'mäng' : 'mängu'}.` : 'Kõik mängud on mängitud.'),
      };
      const me = rows.find(r => r[1] === 'Eesti');
      if (me) summaries.ekk = { competition: `${WC_COMP} · ${last.groupPairingCode}-alagrupp`, headline: `${me[0]}. koht`, sub: `${me[3]} V · ${me[4]} K` };
    }
  }

  // basket.ee: koondise mängud mis tahes sarjas (kellaaeg Eesti aja järgi, ülekanne)
  const extra = [];
  for (const r of [sr, rr]) if (r.status === 'fulfilled') {
    for (const g of parseBasket(r.value)) {
      if (g.home !== 'EESTI' && g.away !== 'EESTI') continue;
      const nm = s => { const n = titleCase(s); if (FLAGS[n]) logos[n] = `flag:${FLAGS[n]}`; return n; };
      const e = { team: 'ekk', date: g.date, time: g.time, title: `${nm(g.home)} – ${nm(g.away)}`, comp: /MM 2027/.test(g.comp) ? WC_COMP : g.comp, place: g.place.startsWith('*') ? '' : g.place, tv: g.tv };
      if (/^\d+:\d+$/.test(g.score)) { const [x, y] = g.score.split(':').map(Number); e.score = g.score; e.result = (g.home === 'EESTI' ? x > y : y > x) ? 'W' : 'L'; }
      extra.push(e);
    }
  }
  if (!fibaOk && !extra.length) throw new Error('korvpallikoondise andmeid ei leitud');
  for (const x of extra) {
    const e = events.find(v => v.date === x.date);
    if (!e) { events.push(x); continue; }
    if (!e.time && x.time) e.time = x.time;
    if (!e.place && x.place) e.place = x.place;
    if (x.tv) e.tv = x.tv;
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const done = events.filter(e => e.score);
  if (done.length) {
    const years = new Set(done.map(e => e.date.slice(0, 4)));
    const fmt = e => years.size > 1 ? `${dm(e.date)}.${e.date.slice(2, 4)}` : dm(e.date);
    panels['ekk-results'] = { title: fibaOk ? 'Valikmängude tulemused' : 'Tulemused', items: done.slice(-10).map(e => ({ date: fmt(e), title: e.title, note: [e._round, e._city || e.place].filter(Boolean).join(', '), score: e.score, result: e.result })) };
  }
  return { panels, summaries, logos, eventSets: [{ team: 'ekk', re: fibaOk ? '.' : null, events: events.map(clean) }] };
}

// ───────────────────────── Pärnu JK Vaprus (jalgpall.ee) ─────────────────────────

const JP = 'https://jalgpall.ee';
const VAPRUS = 'Pärnu JK Vaprus';
const VAP_TEAM = 5387, VAP_LEAGUE = 52;
const FB_SHORT = { 'Tallinna FCI Levadia': 'FCI Levadia', 'Tallinna FC Flora': 'FC Flora', 'Nõmme Kalju FC': 'Nõmme Kalju', 'Tartu JK Tammeka': 'Tartu Tammeka', 'FC Nõmme United': 'Nõmme United', 'JK Narva Trans': 'Narva Trans', 'Tabasalu Ulasabat C.F.': 'Tabasalu' };
const FB_COMP = { PL: 'Premium liiga', KV: 'Tipneri karikas' };

function parseVaprus(html) {
  const i = html.indexOf('table-01 small events');
  if (i < 0) return [];
  const out = [], seen = new Set();
  for (const row of html.slice(i).split('</table>')[0].split('<tr').slice(1)) {
    const dc = row.match(/class="date">([\s\S]*?)<\/td>/);
    if (!dc) continue;
    const m = strip(dc[1]).match(/^(.*?)\s*(\d\d)\.(\d\d)\.(\d{4})(?:\s*Kell\s*(\d\d:\d\d))?/);
    if (!m) continue;
    const side = cls => {
      const cell = (row.split(`class="team ${cls}"`)[1] || '').split('</td>')[0];
      const a = cell.match(/<a[^>]*>([^<]+)<\/a>/), alt = cell.match(/alt="([^"]+)"/), img = cell.match(/<img[^>]*src="([^"]+)"/);
      return { name: dec((a && a[1]) || (alt && alt[1]) || ''), logo: img ? img[1] : null };
    };
    const h = side('left'), a = side('right');
    if (!h.name || !a.name) continue;
    const sc = strip((row.match(/class="vs">([\s\S]*?)<\/td>/) || [])[1] || '').match(/(\d+)\s*-\s*(\d+)/);
    const date = `${m[4]}-${m[3]}-${m[2]}`;
    const key = date + h.name + a.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: m[1].trim(), date, time: m[5] && m[5] !== '00:00' ? m[5] : null, home: h, away: a, score: sc ? [Number(sc[1]), Number(sc[2])] : null });
  }
  return out.sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')));
}

async function vaprus(t) {
  const seasons = [t.y - 1, t.y].concat(t.m >= 11 ? [t.y + 1] : []);
  const pages = await Promise.all(seasons.map(s => get(`${JP}/voistlused/${VAP_LEAGUE}/team/${VAP_TEAM}?season=${s}`).then(parseVaprus).catch(() => null)));
  if (pages.every(p => !p)) throw new Error('jalgpall.ee: Vapruse lehte ei saanud kätte');
  const logos = {};
  const short = x => { const n = x.name === VAPRUS ? 'Vaprus' : (FB_SHORT[x.name] || x.name); if (x.logo && x.name !== VAPRUS) logos[n] = x.logo; return n; };
  const bySeason = {};
  const events = [];
  seasons.forEach((s, i) => {
    bySeason[s] = pages[i] || [];
    for (const g of bySeason[s]) {
      const home = g.home.name === VAPRUS;
      const e = { team: 'vap', date: g.date, time: g.time, title: `${short(g.home)} – ${short(g.away)}`, comp: FB_COMP[g.code] || (/^TT/.test(g.code) ? 'Taliturniir' : g.code) || 'Jalgpall' };
      if (g.score) { const [x, y] = g.score; e.score = `${x}:${y}`; e.result = x === y ? 'D' : ((home ? x > y : y > x) ? 'W' : 'L'); }
      events.push(e);
    }
  });
  if (!events.length) throw new Error('jalgpall.ee: Vapruse mänge ei leitud');

  // Hooaeg, mille kohta tabelit ja numbreid näidata: viimane, kus liigamänge on juba mängitud
  const S = [...seasons].reverse().find(s => bySeason[s].some(g => g.code === 'PL' && g.score)) || [...seasons].reverse().find(s => bySeason[s].length);
  const pl = bySeason[S].filter(g => g.code === 'PL'), plDone = pl.filter(g => g.score);
  const finished = plDone.length > 0 && plDone.length === pl.length;
  const hasNext = events.some(e => !e.score);
  const panels = {}, summaries = {};

  const rec = arr => { let w = 0, d = 0, l = 0, gf = 0, ga = 0; for (const g of arr) { const home = g.home.name === VAPRUS; const [x, y] = home ? g.score : [g.score[1], g.score[0]]; gf += x; ga += y; if (x > y) w++; else if (x === y) d++; else l++; } return { w, d, l, gf, ga, n: arr.length }; };
  const item = g => { const home = g.home.name === VAPRUS; const [x, y] = g.score || []; return { date: dm(g.date), title: `${short(g.home)} – ${short(g.away)}`, note: home ? 'kodus' : 'võõrsil', score: g.score ? `${x}:${y}` : (g.time || ''), result: g.score ? (x === y ? 'D' : ((home ? x > y : y > x) ? 'W' : 'L')) : '' }; };
  if (plDone.length) {
    const all = rec(plDone), hm = rec(plDone.filter(g => g.home.name === VAPRUS)), aw = rec(plDone.filter(g => g.home.name !== VAPRUS));
    const c2 = x => x.toFixed(2).replace('.', ',');
    panels['vap-stats'] = { title: `Hooaeg ${S} numbrites`, callout: '', items: [
      [`${all.w}–${all.d}–${all.l}`, 'võidud–viigid–kaotused'], [`${hm.w}–${hm.d}–${hm.l}`, 'kodus'], [`${aw.w}–${aw.d}–${aw.l}`, 'võõrsil'],
      [`${all.gf}:${all.ga}`, 'väravad'], [c2(all.gf / all.n), 'löödud väravat mängus'], [c2((3 * all.w + all.d) / all.n), 'punkti mängus'],
    ] };
    panels['vap-last'] = { title: `Premium liiga · viimased ${Math.min(10, plDone.length)} mängu`, items: plDone.slice(-10).map(item) };
  }
  panels['vap-cup'] = { title: `Tipneri karikas ${S}`, items: bySeason[S].filter(g => g.code === 'KV').map(item) };

  try {
    const html = await get(`${JP}/voistlused/${VAP_LEAGUE}/liigad?season=${S}`);
    const i = html.indexOf('game-stats');
    const rows = [];
    for (const row of (i < 0 ? '' : html.slice(i).split('</table>')[0]).split('<tr').slice(1)) {
      const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => strip(m[1]));
      if (c.length < 9 || !/^\d+$/.test(c[0])) continue;
      const img = row.match(/<img[^>]*src="([^"]+)"/);
      const full = dec(c[2]), name = full === VAPRUS ? VAPRUS : (FB_SHORT[full] || full);
      if (img && full !== VAPRUS) logos[name] = img[1];
      const [gf, ga] = c[7].split(':').map(Number);
      rows.push([Number(c[0]), name, Number(c[3]), Number(c[4]), Number(c[5]), Number(c[6]), c[7], signed(gf - ga), Number(c[8])]);
    }
    if (rows.length) {
      panels['vap-table'] = { title: `Premium liiga ${S} · ${finished ? 'lõplik tabel' : 'tabel'}`, columns: ['#', 'Meeskond', 'M', 'V', 'Vi', 'K', 'Väravad', '+/−', 'P'], rows, highlight: VAPRUS };
      const me = rows.find(r => r[1] === VAPRUS);
      if (me) summaries.vap = { competition: `Premium liiga ${S}${finished ? ' · hooaeg lõppenud' : ''}`, headline: `${me[0]}. koht`, sub: `${me[8]} punkti`, nextText: hasNext ? '' : 'Uue hooaja mängukava pole veel avaldatud' };
    }
  } catch (_) { /* tabel jääb varuandmetest */ }

  return { panels, summaries, logos, eventSets: [{ team: 'vap', re: '.', events }] };
}

// ───────────────────────── Eesti jalgpallikoondis (jalgpall.ee) ─────────────────────────

// Turniirid, mille kohta jalgpall.ee ei ütle liigat ega alagruppi
const NAT_KNOWN = { 597: { comp: 'Rahvuste liiga C', title: 'Rahvuste liiga C · 4. alagrupp', cutAfter: 2 } };

function parseNat(html) {
  return html.split('class="event-single"').slice(1).map(raw => {
    const b = raw.split('class="actions"')[0];
    const [info, teamsPart = ''] = b.split('class="teams"');
    const ps = [...info.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1]);
    const d = strip(ps[1] || '').match(/(\d\d)\.(\d\d)\.(\d{4})(?:\s*(?:kell|aeg)\s*(\d\d:\d\d))?/i);
    const names = [...teamsPart.matchAll(/class="team">[\s\S]*?<p>([^<]*)<\/p>/g)].map(m => dec(m[1]));
    const flags = [...teamsPart.matchAll(/class="flag">\s*<img[^>]*src="([^"]+)"/g)].map(m => m[1]);
    const sc = strip((teamsPart.match(/class="result">([\s\S]*?)<\/div>/) || [])[1] || '').match(/(\d+)\s*-\s*(\d+)/);
    if (!d || names.length < 2) return null;
    return {
      tname: strip(ps[0] || ''), tid: ((ps[0] || '').match(/tournament\/(\d+)/) || [])[1] || null,
      date: `${d[3]}-${d[2]}-${d[1]}`, time: d[4] && d[4] !== '00:00' ? d[4] : null, place: strip(ps[2] || ''),
      home: names[0], away: names[1], flags, score: sc ? [Number(sc[1]), Number(sc[2])] : null,
    };
  }).filter(Boolean);
}

async function koondis() {
  const list = parseNat(await get(`${JP}/koondis/1/mangud`));
  if (!list.length) throw new Error('jalgpall.ee: koondise mänge ei leitud');
  const logos = {}, panels = {}, summaries = {};
  const flag = (n, src) => { if (FLAGS[n]) logos[n] = `flag:${FLAGS[n]}`; else if (src) logos[n] = src; };
  const compName = g => (NAT_KNOWN[g.tid] && NAT_KNOWN[g.tid].comp) || g.tname.replace(/^UEFA\s+/, '').replace(/^Maavõistlused.*/, 'Maavõistlus') || 'Koondisemäng';

  // Turniir: esimene (tulevastest, siis viimastest mängudest), mille lehel on tabel Eestiga
  const tids = [...new Set(list.map(g => g.tid).filter(Boolean))].slice(0, 2);
  let all = list.slice(), tour = null;
  for (const tid of tids) {
    let html;
    try { html = await get(`${JP}/koondis/1/tournament/${tid}`); } catch (_) { continue; }
    const name = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
    const games = parseNat(html).map(g => ({ ...g, tid, tname: g.tname || name }));
    all = all.concat(games.filter(g => g.home === 'Eesti' || g.away === 'Eesti'));
    if (tour) continue;
    for (const t of html.split('<table').slice(1)) {
      if (!/points/.test(t.slice(0, 120))) continue;
      const rows = [];
      for (const row of t.split('</table>')[0].split('<tr').slice(1)) {
        const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => strip(m[1]));
        if (c.length < 10 || !/^\d+$/.test(c[0])) continue;
        flag(c[1], (row.match(/<img[^>]*src="([^"]+)"/) || [])[1]);
        rows.push([Number(c[0]), c[1], Number(c[2]), Number(c[3]), Number(c[4]), Number(c[5]), signed(Number(c[8])), Number(c[9])]);
      }
      if (rows.some(r => r[1] === 'Eesti')) {
        const players = [];
        const pt = html.split('table-01 bold small')[1];
        if (pt) for (const row of pt.split('</table>')[0].split('<tr').slice(1)) {
          const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => strip(m[1]));
          if (c.length >= 3 && Number(c[2]) > 0) players.push([c[0], Number(c[2])]);
        }
        tour = { tid, name, rows, players, games: games.filter(g => g.home === 'Eesti' || g.away === 'Eesti') };
        break;
      }
    }
  }

  // Sama mäng võib olla mõlemas loendis
  const seen = new Set();
  const events = [];
  for (const g of all.sort((a, b) => a.date.localeCompare(b.date))) {
    const key = g.date + g.home + g.away;
    if (seen.has(key)) continue;
    seen.add(key);
    flag(g.home, g.flags[0]); flag(g.away, g.flags[1]);
    const home = g.home === 'Eesti';
    const e = { team: 'ejk', date: g.date, time: g.time, title: `${g.home} – ${g.away}`, comp: compName(g), place: g.place };
    if (g.score) { const [x, y] = g.score; e.score = `${x}:${y}`; e.result = x === y ? 'D' : ((home ? x > y : y > x) ? 'W' : 'L'); }
    events.push(e);
  }

  const done = events.filter(e => e.score);
  if (done.length) {
    const last = done.slice(-8), mixed = new Set(last.map(e => e.comp)).size > 1;
    panels['ejk-results'] = { title: mixed ? 'Tulemused' : `${last[0].comp} · tulemused`, items: last.map(e => ({ date: dm(e.date), title: e.title, note: [mixed ? e.comp : '', e.place].filter(Boolean).join(' · '), score: e.score, result: e.result })) };
  }

  if (tour) {
    const known = NAT_KNOWN[tour.tid] || {};
    const title = known.title || tour.name.replace(/^UEFA\s+/, '');
    panels['ejk-table'] = { title, columns: ['#', 'Koondis', 'M', 'V', 'Vi', 'K', '+/−', 'P'], rows: tour.rows, highlight: 'Eesti', cutAfter: known.cutAfter || null, callout: '' };
    const me = tour.rows.find(r => r[1] === 'Eesti');
    if (me) summaries.ejk = { competition: title, headline: `${me[0]}. koht`, sub: `${me[7]} punkti` };
    const tg = tour.games.filter(g => g.score);
    if (tg.length) {
      let w = 0, d = 0, l = 0, gf = 0, ga = 0, cs = 0;
      for (const g of tg) { const [x, y] = g.home === 'Eesti' ? g.score : [g.score[1], g.score[0]]; gf += x; ga += y; if (y === 0) cs++; if (x > y) w++; else if (x === y) d++; else l++; }
      panels['ejk-stats'] = { title: `${(known.comp || title)} · statistika`, items: [
        [`${w}–${d}–${l}`, 'võidud–viigid–kaotused'], [`${gf}:${ga}`, 'väravad'], [String(cs), cs === 1 ? 'kuiv mäng' : 'kuiva mängu'],
        ...tour.players.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, g]) => [String(g), `${g === 1 ? 'värav' : 'väravat'}: ${n}`]),
      ] };
    }
  }
  return { panels, summaries, logos, eventSets: [{ team: 'ejk', re: '.', events }] };
}

// ───────────────────────── Ralli MM (WRC): Ott Tänak (Wikipedia) ─────────────────────────
// Kalender on teada (FIA, oktoober 2026). Tulemused ja tabelid loetakse Wikipedia hooajalehe tabelist
// "Drivers' championship": iga etapi veerus on sõitja koht. Sealt tulevad ka etappide võitjad (koht 1).

const TANAK = 'Ott Tänak';
const WRC_CAL = {
  2027: [
    ['Rallye Monte-Carlo', '2027-01-21', '2027-01-24', 'Monaco', 'Segakate'],
    ['Rally Sweden', '2027-02-18', '2027-02-21', 'Rootsi', 'Lumi'],
    ['Safari Rally Kenya', '2027-03-18', '2027-03-21', 'Keenia', 'Kruus'],
    ['Croatia Rally', '2027-04-08', '2027-04-11', 'Horvaatia', 'Asfalt'],
    ['Rally Islas Canarias', '2027-05-06', '2027-05-09', 'Kanaari saared, Hispaania', 'Asfalt'],
    ['Rally Japan', '2027-06-03', '2027-06-06', 'Jaapan', 'Asfalt'],
    ['Acropolis Rally Greece', '2027-06-24', '2027-06-27', 'Kreeka', 'Kruus'],
    ["Rally d'Italia", '2027-07-08', '2027-07-11', 'Rooma, Itaalia', 'Asfalt'],
    ['Rally Estonia', '2027-07-22', '2027-07-25', 'Tartu, Eesti', 'Kruus'],
    ['Rally Finland', '2027-07-29', '2027-08-01', 'Jyväskylä, Soome', 'Kruus'],
    ['Rally USA', '2027-08-26', '2027-08-29', 'USA', 'Kruus'],
    ['Rally Scotland', '2027-09-30', '2027-10-03', 'Aberdeen, Šotimaa', 'Kruus'],
    ['Rally del Paraguay', '2027-10-21', '2027-10-24', 'Paraguay', 'Kruus'],
    ['Rally Chile Biobío', '2027-11-04', '2027-11-07', 'Tšiili', 'Kruus'],
    ['Rally Saudi Arabia', '2027-11-25', '2027-11-28', 'Saudi Araabia', 'Kruus'],
  ],
};
const WRC_FLAG = { Estonia: 'ee', Finland: 'fi', France: 'fr', Belgium: 'be', 'United Kingdom': 'gb', 'Great Britain': 'gb', Ireland: 'ie', Japan: 'jp', Spain: 'es', Sweden: 'se', Norway: 'no', 'New Zealand': 'nz', Greece: 'gr', Italy: 'it', Germany: 'de', Poland: 'pl', 'Czech Republic': 'cz', Czechia: 'cz', Latvia: 'lv', Lithuania: 'lt', Paraguay: 'py', Chile: 'cl', Bolivia: 'bo', Kenya: 'ke', Croatia: 'hr', Austria: 'at', Portugal: 'pt', 'United States': 'us', Mexico: 'mx', Brazil: 'br', Argentina: 'ar', Monaco: 'mc', Luxembourg: 'lu', Slovakia: 'sk', Ukraine: 'ua', Australia: 'au', Netherlands: 'nl', Denmark: 'dk', Switzerland: 'ch', Hungary: 'hu', Romania: 'ro', Bulgaria: 'bg', Turkey: 'tr', 'Saudi Arabia': 'sa', 'South Africa': 'za' };
const MAKER = n => /toyota/i.test(n) ? 'Toyota' : /hyundai/i.test(n) ? 'Hyundai' : /ford|m-sport/i.test(n) ? 'M-Sport Ford' : /skoda|škoda/i.test(n) ? 'Škoda' : /citro/i.test(n) ? 'Citroën' : n.replace(/\s+(World Rally Team|WRT|Rally Team)$/i, '');
const MON3 = ['jaan', 'veebr', 'märts', 'apr', 'mai', 'juuni', 'juuli', 'aug', 'sept', 'okt', 'nov', 'dets'];
function wrcRange(a, b) {
  const [, ma, da] = a.split('-').map(Number), [, mb, db] = b.split('-').map(Number);
  return ma === mb ? `${da}.–${db}. ${MON3[mb - 1]}` : `${da}. ${MON3[ma - 1]} – ${db}. ${MON3[mb - 1]}`;
}

// HTML-tabel ruudustikuks (arvestab rowspan/colspan); iga lahter: { t: tekst, h: html }
function tableGrid(html) {
  const grid = [], hold = [];
  for (const tr of html.split(/<tr[\s>]/).slice(1)) {
    const row = [], body = tr.split('</tr>')[0];
    let col = 0;
    const take = () => { while (hold[col] && hold[col].n > 0) { row[col] = hold[col].c; hold[col].n--; col++; } };
    for (const m of body.matchAll(/<(t[hd])([^>]*)>([\s\S]*?)<\/\1>/g)) {
      take();
      const attrs = m[2], h = m[3];
      const c = { t: strip(h.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')), h, th: m[1] === 'th' };
      const rs = +(attrs.match(/rowspan="?(\d+)/) || [])[1] || 1, cs = +(attrs.match(/colspan="?(\d+)/) || [])[1] || 1;
      for (let k = 0; k < cs; k++) { row[col] = c; if (rs > 1) hold[col] = { c, n: rs - 1 }; col++; }
    }
    take();
    if (row.length) grid.push(row);
  }
  return grid;
}
function findStanding(tables, who) {
  for (const t of tables) {
    const g = tableGrid(t);
    const hi = g.findIndex(r => r.some(c => /^Pos\.?$/.test(c.t)) && r.some(c => c.t === who) && r.some(c => /^(Points|Pts\.?)$/.test(c.t)));
    if (hi < 0) continue;
    const head = g[hi].map(c => c.t);
    const rows = g.slice(hi + 1).filter(r => r[0] && /^\d+$/.test(r[0].t));
    if (rows.length) return { head, rows, nameCol: head.indexOf(who), ptsCol: head.findIndex(x => /^(Points|Pts\.?)$/.test(x)) };
  }
  return null;
}
const placeOf = s => { const m = String(s).match(/^(\d+)/); return m ? +m[1] : null; };

export function parseWrc(html, year) {
  const cal = WRC_CAL[year];
  const tables = html.split(/<table[\s>]/).slice(1).map(x => x.split('</table>')[0]);
  const dr = findStanding(tables, 'Driver');
  if (!dr) throw new Error('wikipedia: sõitjate tabelit ei leitud');
  const firstRound = dr.nameCol + 1, nRounds = Math.min(cal.length, dr.ptsCol - firstRound);
  const logos = {};
  const drivers = dr.rows.map(r => {
    const name = r[dr.nameCol].t;
    const country = (r[dr.nameCol].h.match(/Flag_of_([^.\/"]+?)\.svg/) || [])[1];
    if (country) { const c = WRC_FLAG[decodeURIComponent(country).replace(/_/g, ' ').replace(/^the /, '').replace(/\s*\(.*\)$/, '')]; if (c) logos[name] = `flag:${c}`; }
    return { pos: +r[0].t, name, pts: +(r[dr.ptsCol].t.replace(/[^\d.]/g, '')) || 0, res: Array.from({ length: nRounds }, (_, i) => (r[firstRound + i] || { t: '' }).t) };
  });
  const me = drivers.find(d => d.name === TANAK);
  const winners = Array.from({ length: nRounds }, (_, i) => (drivers.find(d => placeOf(d.res[i]) === 1) || {}).name || '');

  const mk = findStanding(tables, 'Manufacturer');
  const makers = [];
  if (mk) for (const r of mk.rows) { const n = MAKER(r[mk.nameCol].t); if (!makers.some(m => m[1] === n)) makers.push([+r[0].t, n, +(r[mk.ptsCol].t.replace(/[^\d.]/g, '')) || 0]); }

  const events = [], calRows = [];
  cal.forEach(([name, a, b, place, surface], i) => {
    const raw = me && i < nRounds ? me.res[i] : '', p = placeOf(raw), done = !!winners[i];
    const score = p ? `${p}.` : /^Ret/i.test(raw) ? 'Katk.' : /^(WD|DNS|EX|DSQ)/i.test(raw) ? 'Ei lõpetanud' : '';
    const e = { team: 'wrc', date: a, end: b, title: name, comp: `WRC ${year}, ${i + 1}. etapp`, place };
    if (done && score) Object.assign(e, { score, result: p && p <= 3 ? 'W' : p && p <= 10 ? 'D' : 'L', note: winners[i] && winners[i] !== TANAK ? `Võitis ${winners[i]}` : '' });
    events.push(e);
    calRows.push([i + 1, name, wrcRange(a, b), surface, winners[i] || '', done ? (score || '–') : '']);
  });

  const panels = {
    'wrc-cal': { rows: calRows },
    'wrc-drivers': { rows: drivers.slice(0, 10).map(d => [d.pos, d.name, d.pts]), note: me && me.pos > 10 ? `Ott Tänak: ${me.pos}. koht, ${me.pts} p` : '' },
  };
  if (makers.length) panels['wrc-makers'] = { rows: makers };
  const summaries = {};
  if (me) {
    const places = me.res.map(placeOf).filter(Boolean);
    panels['wrc-stats'] = { items: [[`${me.pos}.`, 'koht'], [String(me.pts), 'punkti'], [String(places.filter(x => x === 1).length), 'võitu'], [String(places.filter(x => x <= 3).length), 'poodiumit']] };
    summaries.wrc = { headline: `${me.pos}. koht`, sub: `${me.pts} punkti`, competition: `Ralli MM ${year} · Toyota` };
  }
  return { panels, summaries, logos, eventSets: [{ team: 'wrc', re: '^WRC', events }] };
}

async function wrc(t) {
  const year = Math.max(2027, t.y);
  if (!WRC_CAL[year]) throw new Error(`WRC ${year} kalender puudub`);
  // Enne hooaja algust pole tabelit veel olemas: siis jääb data.json
  if (`${t.y}-${pad(t.m)}-${pad(t.d)}` < WRC_CAL[year][0][2]) return { panels: {}, summaries: {}, logos: {}, eventSets: [] };
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${year}_World_Rally_Championship&prop=text&format=json&formatversion=2&redirects=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'tv-riiel/1.0 (https://tv-riiel.vercel.app; koduvaade)', 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`wikipedia vastas ${r.status}`);
  const j = await r.json();
  return parseWrc((j.parse && j.parse.text) || '', year);
}

// ───────────────────────── Abifunktsioonid ─────────────────────────

async function get(url, ms = 8000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} vastas ${r.status}`);
  return r.text();
}
function dec(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function strip(s) { return dec(String(s).replace(/<[^>]+>/g, ' ')); }
function pad(n) { return String(n).padStart(2, '0'); }
function dm(date) { const [, m, d] = date.split('-'); return `${d}.${m}`; }
function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function bySort(a, b) { return a.sort.localeCompare(b.sort); }
function clean(e) { const o = {}; for (const k in e) if (k[0] !== '_') o[k] = e[k]; return o; }
function titleCase(s) {
  return String(s).toLocaleLowerCase('et').split(' ').map(w => (w === 'ja' ? w : w.split('-').map(p => p.charAt(0).toLocaleUpperCase('et') + p.slice(1)).join('-'))).join(' ');
}
function tzOff(d) {
  const [y, m, day] = d.split('-').map(Number);
  const lastSun = mo => { const x = new Date(Date.UTC(y, mo, 0)); return x.getUTCDate() - x.getUTCDay(); };
  return ((m > 3 && m < 10) || (m === 3 && day >= lastSun(3)) || (m === 10 && day < lastSun(10))) ? '+03:00' : '+02:00';
}
function tallinnToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = k => +p.find(x => x.type === k).value;
  return { y: v('year'), m: v('month'), d: v('day') };
}

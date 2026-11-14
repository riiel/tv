// Faili asukoht projektis: /api/calendar.js

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const events = [];

  // 1) PÄRNU JK VAPRUS — automaatne, jalgpall.ee Premium liiga ICS-kalendrist
  try {
    const icsUrl = 'https://jalgpall.ee/voistlused/download.php?type=calendar.download&action=download&league_id=52';
    const icsRes = await fetch(icsUrl);
    const icsText = await icsRes.text();
    events.push(...parseIcsForTeam(icsText, 'Vaprus', 'jalgpall', 'Pärnu JK Vaprus'));
  } catch (e) {
    // kui ICS ajutiselt ei vasta, jätame need lihtsalt nimekirjast välja
  }

  // 2) KOONDISED JA BC PÄRNU — samast andmefailist, mida kasutab spordileht (/sport/data.json).
  // Andmefail on varuvariant; värsked mängud tulevad allpool /api/sport kaudu.
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const dataRes = await fetch(`https://${host}/sport/data.json`);
    const data = await dataRes.json();
    // Otseandmed alaliitude lehtedelt (/api/sport) kirjutavad andmefaili mängud üle, nagu spordilehelgi
    try {
      const live = await (await fetch(`https://${host}/api/sport`)).json();
      if (live && live.ok) for (const g of live.eventSets || []) {
        if (!g.events || !g.events.length) continue;
        const re = g.re ? new RegExp(g.re) : null, dates = new Set(g.events.map(e => e.date));
        data.events = (data.events || []).filter(e => !(e.team === g.team && (re ? re.test(e.comp || '') : dates.has(e.date)))).concat(g.events);
      }
    } catch (e) {
      // kui otseandmeid ei saa, jäävad andmefaili mängud
    }
    const LABELS = {
      bcp: { sport: 'korvpall', team: 'BC Pärnu' },
      ejk: { sport: 'jalgpall', team: 'Eesti koondis' },
      ekk: { sport: 'korvpall', team: 'Eesti koondis' },
    };
    for (const e of data.events || []) {
      const l = LABELS[e.team];
      if (!l || e.score) continue; // Vaprus tuleb ICS-ist, mängitud mänge kalendris ei näita
      events.push({
        sport: l.sport,
        team: l.team,
        title: `${e.title} (${e.comp})`,
        date: `${e.date}T${e.time || '00:00'}:00`,
        place: e.place || '',
        timeConfirmed: Boolean(e.time),
      });
    }
  } catch (e) {
    // kui andmefaili ei saa kätte, jäävad alles ainult ICS-ist loetud mängud
  }

  // Sorteeri ajaliselt, jäta alles ainult tulevased (+ tänased) mängud
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcoming = events
    .filter(e => e.date && new Date(e.date) >= now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 20);

  res.status(200).json({ events: upcoming, updated: new Date().toISOString() });
}

// --- Abifunktsioonid ICS-i lugemiseks ---

function parseIcsForTeam(icsText, keyword, sport, teamLabel) {
  const blocks = icsText.split('BEGIN:VEVENT').slice(1);
  const results = [];

  for (const block of blocks) {
    const summaryMatch = block.match(/SUMMARY:(.+)/);
    const dtMatch = block.match(/DTSTART(?:;[^:]*)?:(\d{8}T?\d{0,6}Z?)/);
    if (!summaryMatch || !dtMatch) continue;

    const summary = summaryMatch[1].replace(/\r/, '').trim();
    if (!summary.includes(keyword)) continue;

    results.push({
      sport,
      team: teamLabel,
      title: summary,
      date: icsDateToIso(dtMatch[1]),
    });
  }
  return results;
}

function icsDateToIso(raw) {
  const y = raw.slice(0, 4), m = raw.slice(4, 6), d = raw.slice(6, 8);
  let h = '00', min = '00';
  if (raw.length >= 13) {
    h = raw.slice(9, 11);
    min = raw.slice(11, 13);
  }
  return `${y}-${m}-${d}T${h}:${min}:00`;
}

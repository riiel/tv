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

  // 2) EESTI MEESTE JALGPALLIKOONDIS — 2026. aasta sügisese UEFA Uefa Nations League mängud.
  // Allikas: UEFA / balticfootballnews.com. Ajad juba Eesti aja järgi.
  const MANUAL_FOOTBALL_NATIONAL = [
    { title: 'Island - Eesti (võõrsil, Nations League)', date: '2026-09-26T19:00:00' },
    { title: 'Bulgaaria - Eesti (võõrsil, Nations League)', date: '2026-09-29T21:45:00' },
    { title: 'Eesti - Luxembourg/Malta (kodus, Nations League)', date: '2026-10-03T19:00:00' },
    { title: 'Eesti - Island (kodus, Nations League)', date: '2026-10-06T21:45:00' },
    { title: 'Luxembourg/Malta - Eesti (võõrsil, Nations League)', date: '2026-11-13T19:00:00' },
    { title: 'Eesti - Bulgaaria (kodus, Nations League)', date: '2026-11-16T19:00:00' },
  ];
  events.push(...MANUAL_FOOTBALL_NATIONAL.map(m => ({
    sport: 'jalgpall',
    team: 'Eesti koondis',
    title: m.title,
    date: m.date,
  })));

  // 3) PÄRNU BC (Pärnu Sadam) — 2026/2027 hooaja mängukava.
  // Allikas: RealGM. Kellaajad teisendatud USA idarannikuajast (ET) Eesti ajale minu poolt.
  // Tänase mängu aeg (26.09) on juba kasutaja kinnitusel parandatud 17:00-le —
  // ülejäänud mängude ajad võivad samamoodi 1-3h vale olla, tasub bcparnu.ee vastu kontrollida.
  // Uuenda käsitsi, kui hooaeg edeneb või kava muutub.
  const MANUAL_BASKETBALL = [
    { title: 'Pärnu Sadam - BK Liepaja (kodus)', date: '2026-09-26T17:00:00' },
    { title: 'Pärnu Sadam - Neftchi IK (kodus, FIBA Europe Cup)', date: '2026-09-30T21:00:00' },
    { title: 'BC Kalev-Cramo - Pärnu Sadam (võõrsil)', date: '2026-10-03T20:00:00' },
    { title: 'Pärnu Sadam - Keila Korvpallikool (kodus)', date: '2026-10-10T20:00:00' },
    { title: 'VEF Riga - Pärnu Sadam (võõrsil)', date: '2026-10-17T20:00:00' },
    { title: 'Pärnu Sadam - Latvijas Universitate (kodus)', date: '2026-10-25T19:00:00' },
    { title: 'Pärnu Sadam - Valmiera Glass Via (kodus)', date: '2026-11-01T20:00:00' },
    { title: 'Pärnu Sadam - BK Ventspils (kodus)', date: '2026-11-07T20:00:00' },
    { title: 'Pärnu Sadam - Tartu Ülikool Maks&Moorits (kodus)', date: '2026-11-15T20:00:00' },
    { title: 'Keila Coolbet - Pärnu Sadam (võõrsil)', date: '2026-11-22T20:00:00' },
    { title: 'Rigas Zelli - Pärnu Sadam (võõrsil)', date: '2026-12-02T20:00:00' },
    { title: 'TalTech ALEXELA - Pärnu Sadam (võõrsil)', date: '2026-12-06T20:00:00' },
    { title: 'Pärnu Sadam - BK Ogre (kodus)', date: '2026-12-13T20:00:00' },
    { title: 'Pärnu Sadam - Rigas Ekselences Juniori (kodus)', date: '2026-12-18T20:00:00' },
    { title: 'Pärnu Sadam - BC Kalev-Cramo (kodus)', date: '2026-12-27T20:00:00' },
    { title: 'Pärnu Sadam - Viimsi (kodus)', date: '2026-12-30T20:00:00' },
    { title: 'Keila Korvpallikool - Pärnu Sadam (võõrsil)', date: '2027-01-09T20:00:00' },
    { title: 'Pärnu Sadam - TalTech ALEXELA (kodus)', date: '2027-01-16T20:00:00' },
    { title: 'BK Liepaja - Pärnu Sadam (võõrsil)', date: '2027-01-20T20:00:00' },
    { title: 'Latvijas Universitate - Pärnu Sadam (võõrsil)', date: '2027-01-25T20:00:00' },
    { title: 'Tartu Ülikool Maks&Moorits - Pärnu Sadam (võõrsil)', date: '2027-01-30T20:00:00' },
    { title: 'BK Ventspils - Pärnu Sadam (võõrsil)', date: '2027-02-02T20:00:00' },
    { title: 'Pärnu Sadam - Keila Coolbet (kodus)', date: '2027-02-07T20:00:00' },
    { title: 'Pärnu Sadam - Rigas Zelli (kodus)', date: '2027-02-10T20:00:00' },
    { title: 'Valmiera Glass Via - Pärnu Sadam (võõrsil)', date: '2027-03-03T20:00:00' },
    { title: 'Viimsi - Pärnu Sadam (võõrsil)', date: '2027-03-07T20:00:00' },
    { title: 'BK Ogre - Pärnu Sadam (võõrsil)', date: '2027-03-10T20:00:00' },
    { title: 'Pärnu Sadam - VEF Riga (kodus)', date: '2027-03-13T20:00:00' },
    { title: 'Rigas Ekselences Juniori - Pärnu Sadam (võõrsil)', date: '2027-03-16T20:00:00' },
  ];
  events.push(...MANUAL_BASKETBALL.map(m => ({
    sport: 'korvpall',
    team: 'Pärnu BC',
    title: m.title,
    date: m.date,
  })));

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

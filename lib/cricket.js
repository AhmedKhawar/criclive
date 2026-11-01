// CricLive — personal international men's cricket tracker.
// Data comes from ESPN's public sports API (ESPN owns ESPNcricinfo; it serves the same match data).
// Zero dependencies: Node 18+ (built-in fetch).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const SCOREBOARD = 'https://site.web.api.espn.com/apis/personalized/v2/scoreboard/header';
const SITE = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket';
const SITE_NEWS = 'https://site.api.espn.com/apis/site/v2/sports/cricket';
const CORE = 'http://core.espnuk.org/v2/sports/cricket';
const ATHLETE = 'https://site.web.api.espn.com/apis/common/v3/sports/cricket/athletes';

// internationalClassId: 1 = Test, 2 = ODI, 3 = T20I (men's). Women's internationals use separate classes.
const INTL_CLASSES = { '1': 'Test', '2': 'ODI', '3': 'T20I' };

// ---------------------------------------------------------------- fetch + cache

const cache = new Map();

async function getJSON(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < ttlMs) return hit.data;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (hit) return hit.data; // serve stale rather than fail
    throw new Error(`Upstream ${res.status} for ${url}`);
  }
  const data = await res.json();
  cache.set(url, { time: Date.now(), data });
  return data;
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// ---------------------------------------------------------------- match list

function normEvent(e, league) {
  const cls = e.class || {};
  const fs_ = e.fullStatus || {};
  return {
    id: e.id,
    leagueId: league.id,
    series: league.name,
    seriesShort: league.shortAlternateName || league.abbreviation || league.name,
    name: e.name,
    shortName: e.shortName,
    description: e.description,
    title: (e.description || '').split(',')[0],
    format: INTL_CLASSES[cls.internationalClassId] || cls.generalClassCard || '',
    date: e.date,
    endDate: e.endDate,
    seasonStart: e.seasonStartDate,
    seasonEnd: e.seasonEndDate,
    venue: e.location,
    state: e.status, // pre | in | post
    statusText: fs_.type?.detail || e.summary,
    summary: fs_.longSummary || fs_.summary || e.summary,
    dayNumber: fs_.dayNumber,
    battingTeamId: fs_.battingTeamId ? String(fs_.battingTeamId) : null,
    toss: (e.notes || []).find((n) => n.type === 'toss')?.text || null,
    teams: (e.competitors || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((c) => ({
        id: c.id,
        name: c.displayName,
        abbr: c.abbreviation,
        logo: c.logo,
        score: c.score || '',
        winner: !!c.winner,
        color: c.color,
      })),
  };
}

function extractIntl(header) {
  const out = [];
  for (const league of header?.sports?.[0]?.leagues || []) {
    for (const e of league.events || []) {
      const cls = e.class || {};
      if (!INTL_CLASSES[cls.internationalClassId]) continue;
      out.push(normEvent(e, league));
    }
  }
  return out;
}

async function currentMatches() {
  const data = await getJSON(`${SCOREBOARD}?sport=cricket&lang=en&region=in`, 20_000);
  return extractIntl(data);
}

// Run async tasks with a concurrency cap, never rejecting.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx]) };
      } catch (e) {
        out[idx] = { ok: false, error: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function dayRange(fromOffset, toOffset, base = new Date()) {
  const days = [];
  for (let off = fromOffset; off <= toOffset; off++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + off);
    days.push({ date: ymd(d), off });
  }
  return days;
}

// Past days rarely change; near days change often.
const dayTTL = (off) => (off < -2 ? 6 * 3600_000 : off > 3 ? 3600_000 : 5 * 60_000);

// The global scoreboard API returns roughly one day of matches per date,
// so we query each day across a window and merge to build fixtures and results.
async function scheduleMatches() {
  const days = dayRange(-20, 40);
  const results = await pool(days, 8, ({ date, off }) =>
    getJSON(`${SCOREBOARD}?sport=cricket&lang=en&region=in&dates=${date}`, dayTTL(off))
  );
  const byId = new Map();
  for (const r of results) {
    if (!r.ok) continue;
    for (const m of extractIntl(r.value)) byId.set(m.id, m);
  }
  // live data takes priority over the slower-cached schedule data
  try {
    for (const m of await currentMatches()) byId.set(m.id, m);
  } catch {}
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function groupSeries(matches) {
  const map = new Map();
  for (const m of matches) {
    if (!map.has(m.leagueId)) {
      map.set(m.leagueId, {
        id: m.leagueId,
        name: m.series,
        formats: new Set(),
        start: m.date,
        end: m.endDate || m.date,
        matches: [],
      });
    }
    const s = map.get(m.leagueId);
    s.formats.add(m.format);
    s.matches.push(m);
    if (m.date < s.start) s.start = m.date;
    if ((m.endDate || m.date) > s.end) s.end = m.endDate || m.date;
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      formats: [...s.formats],
      live: s.matches.some((m) => m.state === 'in'),
      teams: [
        ...new Map(s.matches.flatMap((m) => m.teams).map((t) => [t.id, t])).values(),
      ],
    }))
    .sort((a, b) => b.live - a.live || new Date(a.start) - new Date(b.start));
}

// ---------------------------------------------------------------- match detail

const statMap = (statistics) => {
  const o = {};
  for (const cat of statistics?.categories || [])
    for (const s of cat.stats || []) o[s.name] = s.displayValue ?? s.value;
  return o;
};

const num = (v) => (v === '' || v == null || isNaN(+v) ? 0 : +v);

const ENTITIES = { amp: '&', dagger: '†', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCharCode(+e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m
  );

function parseDismissal(text, battingName) {
  if (!text) return null;
  let t = decode(text).replace(/\s+\d+\*?\s*\(.*$/, '').trim(); // strip " 2 (3b 0x4 0x6) SR: .."
  if (battingName && t.startsWith(battingName)) t = t.slice(battingName.length).trim();
  return t || null;
}

function buildScorecard(summary, pbpItems) {
  const comp = summary.header?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const rosters = summary.rosters || [];

  // dismissal text keyed by `${period}:${athleteId}`
  const dismissals = {};
  for (const it of pbpItems) {
    if (it.dismissal?.dismissal && it.dismissal.batsman?.athlete?.id) {
      dismissals[`${it.period}:${it.dismissal.batsman.athlete.id}`] = it.dismissal.text;
    }
  }

  // which team batted in which period
  const innings = [];
  for (const c of competitors) {
    for (const ls of c.linescores || []) {
      if (!ls.isBatting) continue;
      const st = statMap(ls.statistics);
      if (!ls.score && !num(st.balls) && !ls.isCurrent) continue;
      innings.push({ period: ls.period, comp: c, ls, st });
    }
  }
  innings.sort((a, b) => a.period - b.period);

  return innings.map(({ period, comp: c, ls, st }) => {
    const batRoster = rosters.find((r) => r.team?.id === c.id)?.roster || [];
    const bowlRoster = rosters.find((r) => r.team?.id !== c.id)?.roster || [];

    const batting = [];
    const yetToBat = [];
    for (const p of batRoster) {
      const pl = p.linescores?.find((l) => l.period === period);
      const s = statMap(pl?.statistics);
      const a = p.athlete || {};
      if (s.batted === '1' || num(s.ballsFaced) > 0 || p.activeName === 'striker' || p.activeName === 'non-striker') {
        const notOut = s.dismissalCard === 'not out' || s.outs === '0';
        const dText = dismissals[`${period}:${a.id}`];
        batting.push({
          id: a.id,
          name: a.displayName,
          captain: !!p.captain,
          keeper: p.position?.abbreviation === 'WK',
          pos: num(s.battingPosition) || 99,
          dismissal: notOut
            ? (s.retiredDescription || 'not out')
            : parseDismissal(dText, a.battingName) || s.dismissalCard || 'out',
          notOut,
          active: p.activeName || null,
          runs: s.runs ?? '0',
          balls: s.ballsFaced ?? '0',
          fours: s.fours ?? '0',
          sixes: s.sixes ?? '0',
          sr: s.strikeRate ?? '-',
          minutes: s.minutes || '',
        });
      } else {
        yetToBat.push({ id: a.id, name: a.displayName });
      }
    }
    batting.sort((x, y) => x.pos - y.pos);

    const bowling = [];
    for (const p of bowlRoster) {
      const pl = p.linescores?.find((l) => l.period === period);
      const s = statMap(pl?.statistics);
      if (!num(s.balls) && !num(s.overs)) continue;
      bowling.push({
        id: p.athlete?.id,
        name: p.athlete?.displayName,
        pos: num(s.bowlingPosition) || 99,
        overs: s.overs,
        maidens: s.maidens,
        runs: s.conceded,
        wickets: s.wickets,
        econ: s.economyRate,
        dots: s.dots,
        fours: s.foursConceded,
        sixes: s.sixesConceded,
        wides: s.wides,
        noballs: s.noballs,
        active: p.activeName === 'bowling' || p.activeName === 'current bowler' ? p.activeName : null,
      });
    }
    bowling.sort((x, y) => x.pos - y.pos);

    return {
      period,
      number: period,
      team: { id: c.id, name: c.team?.displayName, abbr: c.team?.abbreviation, logo: c.team?.logos?.[0]?.href },
      score: ls.score || `${ls.runs}/${ls.wickets}`,
      runs: ls.runs,
      wickets: ls.wickets,
      overs: st.overs ?? ls.overs,
      runRate: st.runRate,
      requiredRunRate: num(st.target) ? st.requiredRunRate : null,
      target: num(st.target) ? st.target : null,
      followOn: !!ls.followOn,
      live: !!ls.isCurrent,
      description: ls.description,
      extras: {
        total: st.extras,
        b: st.byes,
        lb: st.legbyes,
        w: st.wides,
        nb: st.noballs,
        p: st.penalties,
      },
      batting,
      yetToBat,
      bowling,
      fow: (ls.fow || []).map((f) => ({
        wicket: f.wicketNumber,
        runs: f.runs,
        over: f.wicketOver,
        player: f.athlete?.displayName,
        type: f.fowType,
      })),
      partnerships: (ls.partnerships || []).map((p) => ({
        wicket: p.wicketName,
        runs: p.runs,
        overs: p.overs,
        runRate: p.runRate,
        batsmen: (p.batsmen || []).map((b) => ({
          name: b.athlete?.displayName,
          runs: b.runs ?? b.statistics?.runs,
          balls: b.balls ?? b.ballsFaced,
        })),
      })),
    };
  });
}

function normBall(it) {
  const pt = it.playType?.description || '';
  let chip = String(it.scoreValue ?? '');
  if (it.dismissal?.dismissal) chip = 'W';
  else if (pt === 'wide') chip = `${it.scoreValue > 1 ? it.scoreValue : ''}wd`;
  else if (pt === 'no ball') chip = `${it.scoreValue > 1 ? it.scoreValue : ''}nb`;
  else if (pt === 'leg bye') chip = `${it.scoreValue}lb`;
  else if (pt === 'bye') chip = `${it.scoreValue}b`;
  else if (pt === 'no run') chip = '•';
  return {
    id: it.id,
    seq: it.sequence,
    period: it.period,
    periodText: it.periodText,
    over: it.over?.overs ?? null,
    overNumber: it.over?.number ?? null,
    overComplete: !!it.over?.complete,
    overRuns: it.over?.runs,
    overWickets: it.over?.wickets,
    chip,
    type: pt,
    boundary: pt === 'four' || pt === 'six',
    wicket: !!it.dismissal?.dismissal,
    short: it.shortText,
    text: it.text,
    pre: it.preText,
    post: it.postText,
    dismissalText: it.dismissal?.text || null,
    team: it.team?.abbreviation,
    score: it.innings ? `${it.innings.totalRuns ?? ''}` : null,
    teamScore: it.homeScore && it.homeScore !== '0' ? it.homeScore : it.awayScore,
    bowler: it.bowler
      ? { name: it.bowler.athlete?.displayName, overs: it.bowler.overs, maidens: it.bowler.maidens, runs: it.bowler.conceded, wickets: it.bowler.wickets }
      : null,
    batsman: it.batsman
      ? { name: it.batsman.athlete?.displayName, runs: it.batsman.totalRuns, balls: it.batsman.faced, fours: it.batsman.fours, sixes: it.batsman.sixes }
      : null,
    otherBatsman: it.otherBatsman
      ? { name: it.otherBatsman.athlete?.displayName, runs: it.otherBatsman.totalRuns, balls: it.otherBatsman.faced, fours: it.otherBatsman.fours, sixes: it.otherBatsman.sixes }
      : null,
  };
}

// ESPN's CDN sometimes serves an older snapshot of the commentary feed, so we
// remember the newest one seen per match and never go backwards.
const latestCommentary = new Map();
const maxSeq = (items) => items.reduce((m, it) => Math.max(m, it.sequence || 0), 0);

async function fetchCommentary(leagueId, eventId, live) {
  const ttl = live ? 15_000 : 5 * 60_000;
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const d = await getJSON(
      `${SITE}/${leagueId}/playbyplay?event=${eventId}&page=${page}&limit=1000&lang=en&region=in`,
      ttl
    );
    const c = d?.commentary;
    items.push(...(c?.items || []));
    if (!c || page >= (c.pageCount || 1)) break;
  }
  const prev = latestCommentary.get(eventId);
  if (prev && maxSeq(prev) > maxSeq(items)) return prev;
  latestCommentary.set(eventId, items);
  return items;
}

async function matchDetail(leagueId, eventId) {
  const summary = await getJSON(`${SITE}/${leagueId}/summary?event=${eventId}&lang=en&region=in`, 15_000);
  const comp = summary.header?.competitions?.[0] || {};
  const state = comp.status?.type?.state;

  let pbp = [];
  try {
    pbp = await fetchCommentary(leagueId, eventId, state === 'in');
  } catch {}

  const notes = summary.notes || [];
  const noteOf = (t) => notes.filter((n) => n.type === t).map((n) => n.text);

  const balls = pbp.map(normBall).sort((a, b) => a.seq - b.seq);

  // current batters/bowler from the latest ball
  const last = balls[balls.length - 1];
  const currentOver = last
    ? balls.filter((b) => b.period === last.period && b.overNumber === last.overNumber)
    : [];

  const cls = comp.class || {};
  return {
    id: eventId,
    leagueId,
    name: summary.header?.name,
    description: summary.header?.description,
    title: comp.description,
    format: INTL_CLASSES[cls.internationalClassId] || cls.generalClassCard,
    date: comp.date,
    endDate: comp.endDate,
    state,
    statusText: comp.status?.type?.detail,
    summary: comp.status?.summary,
    session: comp.status?.session,
    battingTeamId: comp.status?.battingTeamId ? String(comp.status.battingTeamId) : null,
    teams: (comp.competitors || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((c) => ({
        id: c.id,
        name: c.team?.displayName,
        abbr: c.team?.abbreviation,
        logo: c.team?.logos?.[0]?.href,
        color: c.team?.color,
        score: c.score || '',
        winner: !!c.winner,
      })),
    info: {
      venue: summary.gameInfo?.venue?.fullName,
      city: summary.gameInfo?.venue?.address?.city,
      country: summary.gameInfo?.venue?.address?.country,
      capacity: summary.gameInfo?.venue?.capacity,
      venueImage: summary.gameInfo?.venue?.images?.[0]?.$ref?.replace('http://', 'https://'),
      officials: (summary.gameInfo?.officials || []).map((o) => ({
        name: o.displayName,
        role: o.position?.displayName,
        country: o.flag?.alt,
      })),
      toss: noteOf('toss')[0] || null,
      matchNumber: noteOf('matchnumber')[0] || null,
      season: noteOf('season')[0] || null,
      days: noteOf('matchdays')[0] || null,
      hours: noteOf('hoursofplay')[0] || null,
      playerOfMatch: noteOf('playerofthematch').concat(noteOf('potm'))[0] || null,
      matchNotes: noteOf('matchnote'),
      otherNotes: notes
        .filter((n) => !['toss', 'matchnumber', 'season', 'matchdays', 'hoursofplay', 'matchnote', 'livecommentator', 'livescorer'].includes(n.type))
        .map((n) => ({ type: n.type, text: n.text })),
    },
    squads: (summary.squads || []).map((s) => ({
      team: { id: s.team?.id, name: s.team?.displayName, logo: s.team?.logos?.[0]?.href },
      players: (s.athletes || []).map((a) => ({
        id: a.id,
        name: a.displayName,
        role: a.position?.name,
        captain: !!a.captain,
        keeper: !!a.keeper,
      })),
    })),
    playingXI: (summary.rosters || []).map((r) => ({
      team: { id: r.team?.id, name: r.team?.displayName, logo: r.team?.logos?.[0]?.href },
      players: (r.roster || []).map((p) => ({
        id: p.athlete?.id,
        name: p.athlete?.displayName,
        role: p.athlete?.position?.name,
        style: (p.athlete?.style || []).map((s) => s.description).join(', '),
        captain: !!p.captain,
        keeper: p.position?.abbreviation === 'WK',
        headshot: p.athlete?.headshot?.href,
      })),
    })),
    scorecard: buildScorecard(summary, pbp),
    live: last
      ? {
          batsman: last.batsman,
          otherBatsman: last.otherBatsman,
          bowler: last.bowler,
          currentOver: currentOver.map((b) => b.chip),
          lastBall: last.short,
        }
      : null,
    leaders: (summary.leaders || []).map((l) => ({
      team: l.team?.displayName,
      innings: (l.linescores || []).map((ls) => ({
        period: ls.period,
        categories: (ls.leaders || []).map((c) => ({
          name: c.displayName,
          leaders: (c.leaders || []).map((x) => ({ name: x.athlete?.displayName, value: x.displayValue })),
        })),
      })),
    })),
    news: normNews(summary.news?.articles || []),
    commentaryCount: balls.length,
  };
}

async function matchCommentary(leagueId, eventId) {
  const items = await fetchCommentary(leagueId, eventId, true);
  return items.map(normBall).sort((a, b) => b.seq - a.seq);
}

// ---------------------------------------------------------------- news, series, players

function normNews(articles) {
  return articles.map((a) => ({
    id: a.id,
    headline: a.headline,
    description: a.description,
    published: a.published,
    image: a.images?.[0]?.url,
    link: a.links?.web?.href,
    byline: a.byline,
  }));
}

async function newsFeed() {
  const matches = await currentMatches();
  const leagueIds = [...new Set(matches.map((m) => m.leagueId))];
  const lists = await Promise.allSettled(
    leagueIds.map((id) => getJSON(`${SITE_NEWS}/${id}/news?lang=en&region=in`, 10 * 60_000))
  );
  // Note: ESPN's per-series news feeds overlap heavily, so stories are merged and de-duplicated.
  const byId = new Map();
  for (const r of lists) {
    if (r.status !== 'fulfilled') continue;
    for (const a of normNews(r.value.articles || [])) byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => new Date(b.published) - new Date(a.published));
}

async function seriesDetail(id) {
  const all = await scheduleMatches();
  const known = all.filter((m) => m.leagueId === id);
  const byId = new Map(known.map((m) => [m.id, m]));

  // Fill in the rest of the series by scanning its season dates (capped, since
  // some ICC leagues span years).
  const ref = known[0];
  if (ref?.seasonStart && ref?.seasonEnd) {
    const DAY = 86400_000;
    const now = Date.now();
    const from = Math.max(new Date(ref.seasonStart).getTime(), now - 60 * DAY);
    const to = Math.min(new Date(ref.seasonEnd).getTime(), now + 90 * DAY);
    const days = dayRange(Math.floor((from - now) / DAY), Math.ceil((to - now) / DAY)).filter(
      (d) => d.off < -20 || d.off > 40 // the schedule already covers this window
    );
    const results = await pool(days, 8, ({ date, off }) =>
      getJSON(`${SCOREBOARD}?sport=cricket&lang=en&region=in&dates=${date}`, dayTTL(off))
    );
    for (const r of results) {
      if (!r.ok) continue;
      for (const m of extractIntl(r.value)) if (m.leagueId === id && !byId.has(m.id)) byId.set(m.id, m);
    }
  }
  const s = groupSeries([...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date)))[0] || null;
  let news = [];
  try {
    news = normNews((await getJSON(`${SITE_NEWS}/${id}/news?lang=en&region=in`, 10 * 60_000)).articles || []);
  } catch {}
  let standings = [];
  try {
    const st = await getJSON(`https://site.api.espn.com/apis/v2/sports/cricket/${id}/standings`, 10 * 60_000);
    const groups = st.children?.length ? st.children : st.standings ? [st] : [];
    standings = groups.map((g) => ({
      name: g.name,
      entries: (g.standings?.entries || []).map((e) => ({
        team: e.team?.displayName,
        logo: e.team?.logos?.[0]?.href,
        stats: Object.fromEntries((e.stats || []).map((x) => [x.abbreviation || x.name, x.displayValue])),
      })),
    }));
  } catch {}
  return { series: s, news, standings };
}

async function playerDetail(id) {
  const [core, v3] = await Promise.allSettled([
    getJSON(`${CORE}/athletes/${id}`, 60 * 60_000),
    getJSON(`${ATHLETE}/${id}`, 60 * 60_000),
  ]);
  const c = core.status === 'fulfilled' ? core.value : {};
  const a = v3.status === 'fulfilled' ? v3.value.athlete || {} : {};
  return {
    id,
    name: c.displayName || a.displayName,
    fullName: c.fullName || a.fullName,
    dob: c.dateOfBirth || null,
    age: c.age || a.age,
    role: c.position?.name || a.position?.name,
    styles: (c.styles || c.style || []).map((s) => s.description),
    team: a.team ? { id: a.team.id, name: a.team.displayName, logo: a.team.logos?.[0]?.href } : null,
    headshot: (c.headshot || a.headshot)?.href,
    battingName: c.battingName,
    active: c.active,
    cricinfo: (c.links || a.links || [])[0]?.href || `https://www.cricinfo.com/ci/content/player/${id}.html`,
  };
}

// ---------------------------------------------------------------- http

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// cacheSecs sets the shared (CDN) cache lifetime when deployed; browsers always revalidate.
function send(res, status, body, cacheSecs = 0) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheSecs
      ? `public, max-age=0, s-maxage=${cacheSecs}, stale-while-revalidate=${cacheSecs * 4}`
      : 'no-store',
  });
  res.end(JSON.stringify(body));
}

const routes = [
  [/^\/api\/live$/, async () => currentMatches(), 15],
  [/^\/api\/schedule$/, async () => scheduleMatches(), 300],
  [/^\/api\/series$/, async () => groupSeries(await scheduleMatches()), 300],
  [/^\/api\/series\/(\d+)$/, async (m) => seriesDetail(m[1]), 300],
  [/^\/api\/match\/(\d+)\/(\d+)$/, async (m) => matchDetail(m[1], m[2]), 15],
  [/^\/api\/match\/(\d+)\/(\d+)\/commentary$/, async (m) => matchCommentary(m[1], m[2]), 15],
  [/^\/api\/news$/, async () => newsFeed(), 600],
  [/^\/api\/player\/(\d+)$/, async (m) => playerDetail(m[1]), 3600],
];

// Shared by the local server (dev.js) and the Vercel function (api/index.js).
async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  for (const [re, handler, cacheSecs] of routes) {
    const m = url.pathname.match(re);
    if (!m) continue;
    try {
      return send(res, 200, await handler(m, url), cacheSecs);
    } catch (err) {
      console.error(err.message);
      return send(res, 502, { error: err.message });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

module.exports = { handleApi, startServer };

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return handleApi(req, res);

    let file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(PUBLIC_DIR, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  server.listen(PORT, () => {
    console.log(`CricLive running at http://localhost:${PORT}`);
    // Warm the schedule cache (60 day lookups) so pages load fast, and keep it fresh.
    const warm = () => scheduleMatches().catch((e) => console.error('warmup:', e.message));
    warm();
    setInterval(warm, 4 * 60_000);
  });
}

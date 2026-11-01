/* CricLive frontend — vanilla JS single-page app with hash routing. */

const app = document.getElementById('app');
const LIVE_REFRESH_MS = 20_000;
const TICKER_REFRESH_MS = 30_000;

let pageTimer = null; // auto-refresh timer for the current page
let routeToken = 0; // guards against stale async renders after navigation

// ------------------------------------------------------------------ utils

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Commentary text comes with light HTML (<b>, <a>). Escape everything, then restore
// a small whitelist of formatting tags; links are reduced to their text.
function rich(s) {
  if (!s) return '';
  let t = esc(s);
  t = t.replace(/&lt;(\/?)(b|i|strong|em)\s*&gt;/gi, '<$1$2>');
  t = t.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  t = t.replace(/&lt;a\b.*?&gt;/gi, '').replace(/&lt;\/a&gt;/gi, '');
  t = t.replace(/&amp;(amp|dagger|quot|nbsp|#\d+);/g, '&$1;');
  return t.replace(/\n/g, '<br>');
}

async function api(path) {
  const r = await fetch(path);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtShortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayKey = (d) => new Date(d).toDateString();

function timeAgo(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function ballClass(chip) {
  if (chip === 'W') return 'bW';
  if (chip === '4') return 'b4';
  if (chip === '6') return 'b6';
  if (/wd|nb|lb|b$/.test(chip)) return 'bx';
  return '';
}
const ballHTML = (c) => `<span class="ball ${ballClass(c)}">${esc(c)}</span>`;

// "92/2 (9.5/20 ov, target 192)" -> main "92/2", detail "9.5/20 ov, target 192"
function splitScore(s) {
  const str = String(s || '');
  const i = str.indexOf(' (');
  return i < 0 ? { main: str, detail: '' } : { main: str.slice(0, i), detail: str.slice(i + 2).replace(/\)$/, '') };
}
function scoreHTML(s) {
  const { main, detail } = splitScore(s);
  return `<b>${esc(main)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}`;
}

// Format filter (All / Test / ODI / T20I), remembered between visits.
let formatFilter = localStorage.getItem('fmt') || 'All';
const FORMATS = ['All', 'Test', 'ODI', 'T20I'];
const byFormat = (list) => (formatFilter === 'All' ? list : list.filter((m) => m.format === formatFilter));

function formatChips(onChange) {
  const id = 'fmt' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => {
    document.querySelectorAll(`#${id} .chip`).forEach((b) =>
      b.addEventListener('click', () => {
        formatFilter = b.dataset.f;
        localStorage.setItem('fmt', formatFilter);
        onChange();
      })
    );
  });
  return `<div class="chips" id="${id}">${FORMATS.map(
    (f) => `<button class="chip ${f === formatFilter ? 'active' : ''}" data-f="${f}">${f}</button>`
  ).join('')}</div>`;
}

function statusBadge(m) {
  if (m.state === 'in') return '<span class="badge live">Live</span>';
  if (m.state === 'post') return '<span class="badge res">Result</span>';
  return '<span class="badge pre">Upcoming</span>';
}

const matchHref = (m) => `#/match/${m.leagueId}/${m.id}`;

// ------------------------------------------------------------------ components

function matchCard(m) {
  const statusCls = m.state === 'post' ? 'res' : m.state === 'pre' ? 'pre' : '';
  const status =
    m.state === 'pre'
      ? `${fmtDate(m.date)} · ${fmtTime(m.date)}`
      : m.summary || m.statusText || '';
  const anyWinner = m.teams.some((t) => t.winner);
  return `
  <a class="mcard ${m.state === 'in' ? 'is-live' : ''}" href="${matchHref(m)}">
    <div class="top">
      ${statusBadge(m)} <span class="badge fmt">${esc(m.format)}</span>
      <span class="t">${esc(m.title)} · ${esc(m.seriesShort || m.series)}</span>
    </div>
    ${m.teams
      .map(
        (t) => `
      <div class="team-row ${anyWinner && !t.winner ? 'dim' : ''} ${m.state === 'in' && m.battingTeamId === t.id ? 'batting' : ''}">
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}
        <span class="nm">${esc(t.name)}</span>
        <span class="sc">${scoreHTML(t.score)}</span>
      </div>`
      )
      .join('')}
    <div class="status ${statusCls}">${esc(status)}</div>
    <div class="venue">${esc(m.venue || '')}</div>
  </a>`;
}

function matchRow(m) {
  return `
  <a class="row-item" href="${matchHref(m)}">
    <div class="logos">${m.teams.map((t) => (t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '')).join('')}</div>
    <div class="grow">
      <div class="ttl">${esc(m.teams.map((t) => t.name).join(' vs '))} ${statusBadge(m)}</div>
      <div class="sub"><span class="badge fmt">${esc(m.format)}</span> ${esc(m.title)} · ${esc(m.series)} · ${esc(m.venue || '')}</div>
      ${
        m.state !== 'pre'
          ? `<div class="sub sc">${m.teams.map((t) => `${esc(t.abbr)} ${esc(splitScore(t.score).main || '-')}`).join(' &nbsp;·&nbsp; ')}</div>
             <div class="sub st" style="color:${m.state === 'post' ? 'var(--win)' : 'var(--ball)'}">${esc(m.summary || '')}</div>`
          : ''
      }
    </div>
    <div class="time">${m.state === 'pre' ? fmtTime(m.date) : ''}</div>
  </a>`;
}

function groupedByDate(list) {
  if (!list.length) return '<div class="card empty-state">No matches found.</div>';
  const groups = new Map();
  for (const m of list) {
    const k = dayKey(m.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return [...groups.entries()]
    .map(([k, ms]) => `<div class="date-head">${fmtDate(k)}</div><div class="card flush">${ms.map(matchRow).join('')}</div>`)
    .join('');
}

function newsList(items, compact = false) {
  if (!items.length) return '<div class="muted">No stories right now.</div>';
  return items
    .map(
      (n) => `
    <a class="news-item ${compact ? 'compact' : ''}" href="${esc(n.link || '#')}" target="_blank" rel="noopener">
      ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div>
        <div class="hl">${esc(n.headline)}</div>
        <div class="ds">${esc(n.description || '')}</div>
        <div class="muted small">${n.byline ? esc(n.byline) + ' · ' : ''}${n.published ? timeAgo(n.published) : ''}</div>
      </div>
    </a>`
    )
    .join('');
}

const loading = () => '<div class="loading">Loading…</div>';
const errorBox = (e) => `<div class="card error">Couldn't load data: ${esc(e.message)}</div>`;

// ------------------------------------------------------------------ ticker

async function refreshTicker() {
  const el = document.getElementById('tickerInner');
  try {
    const live = await api('/api/live');
    const order = { in: 0, pre: 1, post: 2 };
    live.sort((a, b) => order[a.state] - order[b.state]);
    el.innerHTML = live.length
      ? live
          .map(
            (m) => `
      <a class="tick" href="${matchHref(m)}">
        <div class="meta">${m.state === 'in' ? '<span class="badge live">Live</span> ' : ''}${esc(m.format)} · ${esc(m.title)} · ${esc(m.seriesShort || '')}</div>
        ${m.teams
          .map((t) => {
            const { main, detail } = splitScore(t.score);
            return `<div class="row"><span>${esc(t.abbr)}</span><span class="sc">${esc(main)}${detail ? `<small>${esc(detail.split(',')[0])}</small>` : ''}</span></div>`;
          })
          .join('')}
        <div class="status">${esc(m.state === 'pre' ? `${fmtShortDate(m.date)}, ${fmtTime(m.date)}` : m.summary || '')}</div>
      </a>`
          )
          .join('')
      : '<div class="tick empty">No international matches in progress right now.</div>';
  } catch {
    /* keep previous ticker */
  }
}

// ------------------------------------------------------------------ pages

async function pageHome(token) {
  app.innerHTML = loading();
  const [live, schedule, news] = await Promise.allSettled([api('/api/live'), api('/api/schedule'), api('/api/news')]);
  if (token !== routeToken) return;

  const render = () => {
    const liveList = live.status === 'fulfilled' ? live.value : [];
    const sched = schedule.status === 'fulfilled' ? schedule.value : [];
    const now = Date.now();
    const inPlay = byFormat(liveList.filter((m) => m.state === 'in'));
    const recent = byFormat(sched.filter((m) => m.state === 'post')).reverse().slice(0, 8);
    const upcoming = byFormat(sched.filter((m) => m.state === 'pre' && new Date(m.date) > now - 86400_000)).slice(0, 8);

    app.innerHTML = `
      ${formatChips(render)}
      <div class="grid">
        <div>
          <h2>Live now</h2>
          ${inPlay.length ? `<div class="match-list">${inPlay.map(matchCard).join('')}</div>` : '<div class="card empty-state">No live international matches right now.</div>'}
          <h2>Upcoming</h2>
          ${upcoming.length ? `<div class="match-list">${upcoming.map(matchCard).join('')}</div>` : '<div class="card empty-state">Nothing scheduled.</div>'}
          <h2>Recent results</h2>
          ${recent.length ? `<div class="match-list">${recent.map(matchCard).join('')}</div>` : '<div class="card empty-state">No recent results.</div>'}
        </div>
        <aside>
          <h2>Top stories</h2>
          <div class="card">${news.status === 'fulfilled' ? newsList(news.value.slice(0, 10), true) : '<div class="muted">News unavailable.</div>'}</div>
        </aside>
      </div>`;
  };
  render();

  pageTimer = setInterval(async () => {
    try {
      live.value = await api('/api/live');
      live.status = 'fulfilled';
      if (token === routeToken) render();
    } catch {}
  }, LIVE_REFRESH_MS);
}

async function pageSchedule(token, mode) {
  app.innerHTML = loading();
  let sched;
  try {
    sched = await api('/api/schedule');
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  let q = '';
  const render = () => {
    let list =
      mode === 'results'
        ? sched.filter((m) => m.state === 'post').reverse()
        : sched.filter((m) => m.state !== 'post');
    list = byFormat(list);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((m) => (m.name + ' ' + m.series + ' ' + (m.venue || '')).toLowerCase().includes(s));
    }
    app.innerHTML = `
      <h1>${mode === 'results' ? 'Results' : 'Schedule & Live'}</h1>
      <div class="toolbar">
        ${formatChips(render)}
        <input class="search" id="q" placeholder="Filter by team, series, venue…" value="${esc(q)}">
      </div>
      ${groupedByDate(list)}`;
    const input = document.getElementById('q');
    input.addEventListener('input', () => {
      q = input.value;
      const pos = input.selectionStart;
      render();
      const again = document.getElementById('q');
      again.focus();
      again.setSelectionRange(pos, pos);
    });
  };
  render();
}

async function pageSeriesList(token) {
  app.innerHTML = loading();
  let series;
  try {
    series = await api('/api/series');
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  const now = Date.now();
  const section = (title, list) =>
    list.length
      ? `<h2>${title}</h2><div class="card flush">${list
          .map(
            (s) => `
      <a class="row-item" href="#/series/${s.id}">
        <div class="logos">${s.teams.slice(0, 4).map((t) => (t.logo ? `<img src="${esc(t.logo)}" alt="">` : '')).join('')}</div>
        <div class="grow">
          <div class="ttl">${esc(s.name)} ${s.live ? '<span class="badge live">Live</span>' : ''}</div>
          <div class="sub">${fmtShortDate(s.start)} – ${fmtShortDate(s.end)} · ${s.formats.map((f) => `<span class="badge fmt">${esc(f)}</span>`).join(' ')} · ${s.matches.length} match${s.matches.length === 1 ? '' : 'es'}</div>
        </div>
      </a>`
          )
          .join('')}</div>`
      : '';
  const ongoing = series.filter((s) => s.live || s.matches.some((m) => m.state === 'post') && s.matches.some((m) => m.state !== 'post'));
  const upcoming = series.filter((s) => !ongoing.includes(s) && s.matches.every((m) => m.state === 'pre'));
  const done = series.filter((s) => !ongoing.includes(s) && !upcoming.includes(s)).sort((a, b) => new Date(b.end) - new Date(a.end));
  app.innerHTML = `<h1>Series</h1>
    ${section('Ongoing', ongoing)}
    ${section('Upcoming', upcoming.filter((s) => new Date(s.start) > now - 86400_000))}
    ${section('Recently completed', done)}`;
}

async function pageSeries(token, id) {
  app.innerHTML = loading();
  let d;
  try {
    d = await api(`/api/series/${id}`);
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  if (!d.series) {
    app.innerHTML = '<div class="card empty-state">Series not found in the current schedule window.</div>';
    return;
  }
  const s = d.series;
  let tab = 'matches';
  const render = () => {
    const tabs = [
      ['matches', 'Fixtures & Results'],
      ...(d.standings.some((g) => g.entries.length) ? [['table', 'Points Table']] : []),
      ['news', 'News'],
    ];
    let body = '';
    if (tab === 'matches') {
      const results = s.matches.filter((m) => m.state === 'post');
      const rest = s.matches.filter((m) => m.state !== 'post');
      body = `${rest.length ? `<h2>Live & upcoming</h2>${groupedByDate(rest)}` : ''}
              ${results.length ? `<h2>Results</h2>${groupedByDate(results.slice().reverse())}` : ''}`;
    } else if (tab === 'table') {
      body = d.standings
        .map((g) => {
          const cols = Object.keys(g.entries[0]?.stats || {});
          return `<div class="card flush"><div class="inn-head">${esc(g.name)}</div><div class="tbl-scroll"><table>
            <tr><th>Team</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
            ${g.entries.map((e) => `<tr><td class="name">${esc(e.team)}</td>${cols.map((c) => `<td>${esc(e.stats[c])}</td>`).join('')}</tr>`).join('')}
          </table></div></div>`;
        })
        .join('');
    } else {
      body = `<div class="card">${newsList(d.news)}</div>`;
    }
    app.innerHTML = `
      <div class="card mhead">
        <h1 style="margin:0">${esc(s.name)} ${s.live ? '<span class="badge live">Live</span>' : ''}</h1>
        <div class="muted" style="margin-top:6px">${fmtDate(s.start)} – ${fmtDate(s.end)} · ${s.formats.join(', ')}</div>
        <div class="logos" style="margin-top:10px">${s.teams.map((t) => (t.logo ? `<img src="${esc(t.logo)}" alt="${esc(t.name)}" title="${esc(t.name)}" style="width:34px;height:34px">` : '')).join('')}</div>
      </div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      ${body}`;
    app.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.t), render())));
  };
  render();
}

async function pageTeams(token) {
  app.innerHTML = loading();
  let sched;
  try {
    sched = await api('/api/schedule');
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  const teams = new Map();
  for (const m of sched) for (const t of m.teams) if (!teams.has(t.id)) teams.set(t.id, t);
  const list = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = `<h1>Teams</h1>
    <p class="muted">Teams with men's international fixtures or results in the last 3 weeks and next 6 weeks.</p>
    <div class="team-grid">${list
      .map((t) => `<a class="team-tile" href="#/team/${t.id}">${t.logo ? `<img src="${esc(t.logo)}" alt="">` : ''}${esc(t.name)}</a>`)
      .join('')}</div>`;
}

async function pageTeam(token, id) {
  app.innerHTML = loading();
  let sched;
  try {
    sched = await api('/api/schedule');
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  const matches = sched.filter((m) => m.teams.some((t) => t.id === id));
  const team = matches[0]?.teams.find((t) => t.id === id);
  if (!team) {
    app.innerHTML = '<div class="card empty-state">No recent or upcoming matches for this team.</div>';
    return;
  }
  const results = matches.filter((m) => m.state === 'post').reverse();
  const rest = matches.filter((m) => m.state !== 'post');
  const wins = results.filter((m) => m.teams.find((t) => t.id === id)?.winner).length;
  app.innerHTML = `
    <div class="card mhead" style="display:flex;align-items:center;gap:16px">
      ${team.logo ? `<img src="${esc(team.logo)}" alt="" style="width:64px;height:64px;object-fit:contain">` : ''}
      <div><h1 style="margin:0">${esc(team.name)}</h1>
      <div class="muted">Last 3 weeks: ${results.length} played, ${wins} won</div></div>
    </div>
    ${rest.length ? `<h2>Live & upcoming</h2>${groupedByDate(rest)}` : ''}
    ${results.length ? `<h2>Recent results</h2>${groupedByDate(results)}` : ''}`;
}

async function pageNews(token) {
  app.innerHTML = loading();
  let news;
  try {
    news = await api('/api/news');
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  app.innerHTML = `<h1>News</h1><div class="card">${newsList(news)}</div>`;
}

async function pagePlayer(token, id) {
  app.innerHTML = loading();
  let p;
  try {
    p = await api(`/api/player/${id}`);
  } catch (e) {
    app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;
  const row = (k, v) => (v ? `<div class="k">${k}</div><div>${esc(v)}</div>` : '');
  app.innerHTML = `
    <div class="card mhead">
      <div class="profile">
        <img class="hs" src="${esc(p.headshot || '')}" alt="" onerror="this.style.visibility='hidden'">
        <div>
          <h1 style="margin:0">${esc(p.name)}</h1>
          ${p.team ? `<a href="#/team/${p.team.id}" style="display:flex;align-items:center;gap:6px;margin-top:6px;font-weight:600">${p.team.logo ? `<img src="${esc(p.team.logo)}" style="width:20px;height:20px">` : ''}${esc(p.team.name)}</a>` : ''}
          <div class="muted" style="margin-top:4px">${esc(p.role || '')}</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Personal information</h3>
      <div class="kv">
        ${row('Full name', p.fullName)}
        ${row('Born', p.dob ? fmtDate(p.dob) : '')}
        ${row('Age', p.age ? `${p.age} years` : '')}
        ${row('Playing role', p.role)}
        ${row('Style', (p.styles || []).join(', '))}
        ${row('Scorecard name', p.battingName)}
      </div>
      <p style="margin-top:16px"><a class="btn" href="${esc(p.cricinfo)}" target="_blank" rel="noopener">Full career stats on ESPNcricinfo ↗</a></p>
    </div>`;
}

// ------------------------------------------------------------------ match page

const playerLink = (id, name) => (id ? `<a href="#/player/${id}">${esc(name)}</a>` : esc(name));

function scorecardInnings(inn) {
  const ex = inn.extras || {};
  const exParts = [['b', ex.b], ['lb', ex.lb], ['w', ex.w], ['nb', ex.nb], ['p', ex.p]].filter(([, v]) => +v).map(([k, v]) => `${k} ${v}`);
  return `
  <div class="card flush">
    <div class="inn-head">
      <span>${esc(inn.team.name)} — Innings ${inn.number}${inn.followOn ? ' (f/o)' : ''} ${inn.live ? '<span class="badge live">Live</span>' : ''}</span>
      <span class="sc">${esc(inn.score.split(' (')[0])} <span style="font-weight:500;font-size:12px">(${esc(inn.overs)} ov)</span></span>
    </div>
    <div class="tbl-scroll"><table>
      <tr><th>Batter</th><th class="dis"></th><th>R</th><th>B</th><th class="hide-sm">M</th><th>4s</th><th>6s</th><th>SR</th></tr>
      ${inn.batting
        .map(
          (b) => `
        <tr class="${inn.live && b.active ? 'active-row' : ''}">
          <td class="name">${playerLink(b.id, b.name)}${b.captain ? '<span class="tag">(c)</span>' : ''}${b.keeper ? '<span class="tag">†</span>' : ''}${inn.live && b.active === 'striker' ? ' *' : ''}
            <span class="dis-m">${esc(b.dismissal)}</span></td>
          <td class="dis">${esc(b.dismissal)}</td>
          <td class="b">${esc(b.runs)}</td><td>${esc(b.balls)}</td><td class="hide-sm">${esc(b.minutes || '-')}</td>
          <td>${esc(b.fours)}</td><td>${esc(b.sixes)}</td><td>${esc(b.sr)}</td>
        </tr>`
        )
        .join('')}
    </table></div>
    <div class="inn-foot">Extras: <b>${esc(ex.total || 0)}</b> <span class="muted">${exParts.length ? `(${exParts.join(', ')})` : ''}</span></div>
    <div class="inn-foot">Total: <b>${esc(inn.score.split(' (')[0])}</b> <span class="muted">(${esc(inn.overs)} overs${inn.runRate ? `, RR: ${esc(inn.runRate)}` : ''})</span>
      ${inn.target ? ` · Target ${esc(inn.target)}${inn.requiredRunRate ? `, RRR ${esc(inn.requiredRunRate)}` : ''}` : ''}</div>
    ${inn.yetToBat.length ? `<div class="inn-foot"><span class="muted">${inn.live ? 'Yet to bat' : 'Did not bat'}:</span> ${inn.yetToBat.map((p) => playerLink(p.id, p.name)).join(', ')}</div>` : ''}
    ${inn.fow.length ? `<div class="fow"><b style="color:var(--text)">Fall of wickets:</b> ${inn.fow.map((f) => `${f.wicket}-${f.runs} (${esc(f.player)}${f.over ? `, ${f.over} ov` : ''})`).join(', ')}</div>` : ''}
    <div class="tbl-scroll"><table>
      <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th><th class="hide-sm">0s</th><th class="hide-sm">4s</th><th class="hide-sm">6s</th><th class="hide-sm">WD</th><th class="hide-sm">NB</th></tr>
      ${inn.bowling
        .map(
          (b) => `
        <tr><td class="name">${playerLink(b.id, b.name)}</td><td>${esc(b.overs)}</td><td>${esc(b.maidens)}</td><td>${esc(b.runs)}</td>
        <td class="b">${esc(b.wickets)}</td><td>${esc(b.econ)}</td><td class="hide-sm">${esc(b.dots)}</td><td class="hide-sm">${esc(b.fours)}</td><td class="hide-sm">${esc(b.sixes)}</td>
        <td class="hide-sm">${esc(b.wides)}</td><td class="hide-sm">${esc(b.noballs)}</td></tr>`
        )
        .join('')}
    </table></div>
    ${
      inn.partnerships.length
        ? `<details style="padding:10px 14px"><summary style="cursor:pointer;font-weight:700">Partnerships</summary>
          <table style="margin-top:8px"><tr><th>Wkt</th><th style="text-align:left">Batters</th><th>Runs</th><th>Overs</th><th>RR</th></tr>
          ${inn.partnerships
            .map(
              (p) => `<tr><td>${esc(p.wicket)}</td><td style="text-align:left">${p.batsmen.map((b) => `${esc(b.name)} ${esc(b.runs ?? '')}${b.balls ? ` (${esc(b.balls)})` : ''}`).join(' & ')}</td>
              <td class="b">${esc(p.runs)}</td><td>${esc(p.overs)}</td><td>${esc(p.runRate)}</td></tr>`
            )
            .join('')}</table></details>`
        : ''
    }
  </div>`;
}

function commentaryList(balls, limit) {
  let html = '';
  for (const b of balls.slice(0, limit)) {
    if (b.overComplete) {
      html += `<div class="over-sum">
        <span class="l">End of over ${esc(b.overNumber)} · ${esc(b.overRuns)} run${b.overRuns === 1 ? '' : 's'}${b.overWickets ? `, ${b.overWickets} wkt` : ''} · ${esc(b.team)} ${esc(b.teamScore || '')}</span>
        <span>${b.batsman ? `${esc(b.batsman.name)} ${esc(b.batsman.runs)} (${esc(b.batsman.balls)})` : ''}${b.otherBatsman ? ` · ${esc(b.otherBatsman.name)} ${esc(b.otherBatsman.runs)} (${esc(b.otherBatsman.balls)})` : ''}</span>
        <span>${b.bowler ? `${esc(b.bowler.name)} ${esc(b.bowler.overs)}-${esc(b.bowler.maidens)}-${esc(b.bowler.runs)}-${esc(b.bowler.wickets)}` : ''}</span>
      </div>`;
    }
    if (b.post) html += `<div class="pretext">${rich(b.post)}</div>`;
    html += `
    <div class="cball ${b.wicket ? 'wicket' : ''}">
      <div class="ov"><div class="n">${esc(b.over ?? '')}</div>${ballHTML(b.chip)}</div>
      <div class="txt">
        <div class="s ${b.wicket ? 'wk' : ''}">${esc(b.short || '')}</div>
        <div class="d">${rich(b.text)}</div>
        ${b.wicket && b.dismissalText ? `<div class="dm">${rich(b.dismissalText)}</div>` : ''}
      </div>
    </div>`;
    if (b.pre) html += `<div class="pretext">${rich(b.pre)}</div>`;
  }
  return html;
}

async function pageMatch(token, leagueId, id, initialTab) {
  app.innerHTML = loading();
  const state = {
    tab: initialTab || 'summary',
    inn: null, // scorecard innings filter
    cInn: 'all', // commentary innings filter
    cFilter: 'all', // all | wickets | boundaries
    cLimit: 60,
    match: null,
    balls: [],
    lastUpdated: null,
  };

  async function load() {
    const [m, c] = await Promise.allSettled([
      api(`/api/match/${leagueId}/${id}`),
      api(`/api/match/${leagueId}/${id}/commentary`),
    ]);
    if (m.status === 'rejected') throw m.reason;
    state.match = m.value;
    state.balls = c.status === 'fulfilled' ? c.value : [];
    state.lastUpdated = new Date();
  }

  try {
    await load();
  } catch (e) {
    if (token === routeToken) app.innerHTML = errorBox(e);
    return;
  }
  if (token !== routeToken) return;

  function header(m) {
    const anyWinner = m.teams.some((t) => t.winner);
    const statusCls = m.state === 'post' ? 'res' : '';
    return `
    <div class="card mhead">
      <div class="desc">${statusBadge(m)} <span class="badge fmt">${esc(m.format)}</span> ${esc(m.description || '')}
        · <a class="series-link" href="#/series/${m.leagueId}">Series home</a></div>
      ${m.teams
        .map(
          (t) => `
        <div class="mteam ${anyWinner && !t.winner ? 'dim' : ''}">
          ${t.logo ? `<img src="${esc(t.logo)}" alt="">` : ''}
          <a class="nm" href="#/team/${t.id}">${esc(t.name)}${m.state === 'in' && m.battingTeamId === t.id ? ' <span class="badge live" style="vertical-align:middle">Batting</span>' : ''}</a>
          <span class="sc">${scoreHTML(t.score)}</span>
        </div>`
        )
        .join('')}
      <div class="status ${statusCls}">${esc(m.state === 'pre' ? `Starts ${fmtDate(m.date)}, ${fmtTime(m.date)}` : m.summary || m.statusText || '')}</div>
      ${m.state === 'in' ? `<div class="refresh-note">Auto-refreshing every ${LIVE_REFRESH_MS / 1000}s · updated ${state.lastUpdated.toLocaleTimeString()}</div>` : ''}
    </div>`;
  }

  function summaryTab(m) {
    let html = '';
    if (m.state === 'in' && m.live) {
      const L = m.live;
      const bat = (p) => (p ? `<tr><td class="name">${esc(p.name)}</td><td class="b">${esc(p.runs)}</td><td>${esc(p.balls)}</td><td>${esc(p.fours)}</td><td>${esc(p.sixes)}</td><td>${p.balls ? ((p.runs / p.balls) * 100).toFixed(1) : '-'}</td></tr>` : '');
      html += `
      <div class="live-box">
        <div class="card flush"><table>
          <tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
          ${bat(L.batsman)}${bat(L.otherBatsman)}
        </table>
        <table><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th></tr>
          ${L.bowler ? `<tr><td class="name">${esc(L.bowler.name)}</td><td>${esc(L.bowler.overs)}</td><td>${esc(L.bowler.maidens)}</td><td>${esc(L.bowler.runs)}</td><td class="b">${esc(L.bowler.wickets)}</td></tr>` : ''}
        </table></div>
        <div class="card">
          <h3>This over</h3>
          <div class="over-balls">${L.currentOver.map(ballHTML).join('') || '<span class="muted">—</span>'}</div>
          <h3 style="margin-top:16px">Recent balls</h3>
          <div class="over-balls">${state.balls.slice(0, 18).reverse().map((b) => ballHTML(b.chip)).join('')}</div>
        </div>
      </div>`;
    }

    // Innings totals
    if (m.scorecard.length) {
      html += `<div class="card flush"><table>
        <tr><th>Innings</th><th>Score</th><th>Overs</th><th>RR</th></tr>
        ${m.scorecard.map((i) => `<tr><td class="name">${esc(i.team.name)} ${i.number > 2 || m.format === 'Test' ? `(${ordinal(i.number)} inns)` : ''}</td><td class="b">${esc(i.score.split(' (')[0])}</td><td>${esc(i.overs)}</td><td>${esc(i.runRate || '-')}</td></tr>`).join('')}
      </table></div>`;
    }

    // Top performers from the scorecard
    if (m.scorecard.length) {
      const perfs = m.scorecard.map((inn) => {
        const bats = inn.batting.slice().sort((a, b) => +b.runs - +a.runs).slice(0, 2);
        const bowls = inn.bowling.slice().sort((a, b) => +b.wickets - +a.wickets || +a.runs - +b.runs).slice(0, 2);
        return `<div class="card"><h3>${esc(inn.team.name)} — Innings ${inn.number}</h3>
          ${bats.map((b) => `<div class="perf"><span>${playerLink(b.id, b.name)}</span><span class="b">${esc(b.runs)}${b.notOut ? '*' : ''} <span class="muted">(${esc(b.balls)})</span></span></div>`).join('')}
          ${bowls.map((b) => `<div class="perf"><span>${playerLink(b.id, b.name)}</span><span class="b">${esc(b.wickets)}/${esc(b.runs)} <span class="muted">(${esc(b.overs)})</span></span></div>`).join('')}
        </div>`;
      });
      html += `<h2>Key performers</h2><div class="squads">${perfs.join('')}</div>`;
    }

    if (state.balls.length) {
      html += `<h2>Latest commentary</h2><div class="card comm">${commentaryList(state.balls, 12)}
        <button class="load-more" data-goto="commentary">Full commentary →</button></div>`;
    }

    const info = m.info;
    html += `<div class="card"><div class="kv">
      ${info.toss ? `<div class="k">Toss</div><div>${esc(info.toss)}</div>` : ''}
      ${info.playerOfMatch ? `<div class="k">Player of the match</div><div>${esc(info.playerOfMatch)}</div>` : ''}
      ${info.venue ? `<div class="k">Venue</div><div>${esc(info.venue)}</div>` : ''}
    </div></div>`;

    if (m.news.length) html += `<h2>Match news</h2><div class="card">${newsList(m.news.slice(0, 5), true)}</div>`;
    return html;
  }

  function scorecardTab(m) {
    if (!m.scorecard.length) return '<div class="card empty-state">Scorecard will be available once the match starts.</div>';
    if (state.inn == null) state.inn = 'all';
    const chips = [['all', 'All innings'], ...m.scorecard.map((i) => [String(i.number), `${i.team.abbr} ${m.scorecard.length > 2 ? ordinal(i.number) + ' inns' : ''}`])];
    const shown = state.inn === 'all' ? m.scorecard : m.scorecard.filter((i) => String(i.number) === state.inn);
    return `<div class="chips inn-switch">${chips.map(([k, l]) => `<button class="chip ${state.inn === k ? 'active' : ''}" data-inn="${k}">${esc(l)}</button>`).join('')}</div>
      ${shown.map(scorecardInnings).join('')}`;
  }

  function commentaryTab() {
    let balls = state.balls;
    if (!balls.length) return '<div class="card empty-state">No ball-by-ball commentary available.</div>';
    const periods = [...new Set(balls.map((b) => b.period))].sort();
    if (state.cInn !== 'all') balls = balls.filter((b) => String(b.period) === state.cInn);
    if (state.cFilter === 'wickets') balls = balls.filter((b) => b.wicket);
    if (state.cFilter === 'boundaries') balls = balls.filter((b) => b.boundary);
    const teamOf = (p) => state.match.scorecard.find((i) => i.period === p)?.team.abbr || `Inns ${p}`;
    return `
      <div class="chips">
        <button class="chip ${state.cInn === 'all' ? 'active' : ''}" data-cinn="all">All innings</button>
        ${periods.map((p) => `<button class="chip ${state.cInn === String(p) ? 'active' : ''}" data-cinn="${p}">${esc(teamOf(p))}${periods.length > 2 ? ` (${ordinal(p)})` : ''}</button>`).join('')}
        <span style="width:16px"></span>
        ${[['all', 'All balls'], ['wickets', 'Wickets'], ['boundaries', '4s & 6s']].map(([k, l]) => `<button class="chip ${state.cFilter === k ? 'active' : ''}" data-cf="${k}">${l}</button>`).join('')}
      </div>
      <div class="card comm">
        ${commentaryList(balls, state.cLimit) || '<div class="empty-state">Nothing here.</div>'}
        ${balls.length > state.cLimit ? `<button class="load-more" id="more">Load more (${balls.length - state.cLimit} remaining)</button>` : ''}
      </div>`;
  }

  function squadsTab(m) {
    const xi = m.playingXI.filter((t) => t.players.length);
    const groups = xi.length ? xi : m.squads;
    if (!groups.length || !groups.some((g) => g.players.length)) return '<div class="card empty-state">Squads not announced yet.</div>';
    return `<h2>${xi.length ? 'Playing XI' : 'Squads'}</h2><div class="squads">${groups
      .map(
        (g) => `<div class="card"><h3 style="display:flex;align-items:center;gap:8px">${g.team.logo ? `<img src="${esc(g.team.logo)}" style="width:24px;height:24px">` : ''}${esc(g.team.name)}</h3>
        ${g.players
          .map(
            (p) => `<a class="player" href="#/player/${p.id}">
            ${p.headshot ? `<img src="${esc(p.headshot)}" alt="" loading="lazy">` : ''}
            <div><div class="nm">${esc(p.name)}${p.captain ? '<span class="tag">(c)</span>' : ''}${p.keeper ? '<span class="tag">(wk)</span>' : ''}</div>
            <div class="rl">${esc([p.role, p.style].filter(Boolean).join(' · '))}</div></div></a>`
          )
          .join('')}</div>`
      )
      .join('')}</div>
      ${xi.length && m.squads.some((s) => s.players.length > 11) ? `<h2>Full squads</h2><div class="squads">${m.squads.map((g) => `<div class="card"><h3>${esc(g.team.name)}</h3><div class="muted">${g.players.map((p) => `<a href="#/player/${p.id}">${esc(p.name)}</a>${p.captain ? ' (c)' : ''}${p.keeper ? ' (wk)' : ''}`).join(', ')}</div></div>`).join('')}</div>` : ''}`;
  }

  function infoTab(m) {
    const i = m.info;
    const row = (k, v) => (v ? `<div class="k">${k}</div><div>${esc(v)}</div>` : '');
    return `<div class="card"><h3>Match details</h3><div class="kv">
        ${row('Match', m.description)}
        ${row('Format', m.format)}
        ${row('Match number', i.matchNumber)}
        ${row('Season', i.season)}
        ${row('Toss', i.toss)}
        ${row('Player of the match', i.playerOfMatch)}
        ${row('Match days', i.days)}
        ${row('Hours of play', i.hours)}
        ${row('Start (your time)', m.date ? `${fmtDate(m.date)}, ${fmtTime(m.date)}` : '')}
        ${i.officials.map((o) => row(cap(o.role), `${o.name}${o.country ? ` (${o.country})` : ''}`)).join('')}
        ${i.otherNotes.map((n) => row(cap(n.type), n.text)).join('')}
      </div></div>
      <div class="card"><h3>Venue</h3>
        ${i.venueImage ? `<img src="${esc(i.venueImage)}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:10px" onerror="this.remove()">` : ''}
        <div class="kv">${row('Ground', i.venue)}${row('City', i.city)}${row('Country', i.country)}${row('Capacity', i.capacity ? Number(i.capacity).toLocaleString() : '')}</div>
      </div>
      ${i.matchNotes.length ? `<div class="card"><h3>Match notes</h3><ul style="margin:0;padding-left:18px">${i.matchNotes.map((n) => `<li>${rich(n)}</li>`).join('')}</ul></div>` : ''}`;
  }

  function newsTab(m) {
    return `<div class="card">${newsList(m.news)}</div>`;
  }

  function render() {
    const m = state.match;
    const tabs = [
      ['summary', m.state === 'in' ? 'Live' : 'Summary'],
      ['scorecard', 'Scorecard'],
      ['commentary', 'Commentary'],
      ['squads', 'Squads'],
      ['info', 'Match Info'],
      ['news', 'News'],
    ];
    const body = {
      summary: summaryTab,
      scorecard: scorecardTab,
      commentary: commentaryTab,
      squads: squadsTab,
      info: infoTab,
      news: newsTab,
    }[state.tab](m);
    const y = window.scrollY;
    app.innerHTML = `${header(m)}
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === state.tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      ${body}`;
    window.scrollTo(0, y);

    app.querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        history.replaceState(null, '', `#/match/${leagueId}/${id}/${state.tab}`);
        render();
      })
    );
    app.querySelectorAll('[data-goto]').forEach((b) =>
      b.addEventListener('click', () => {
        state.tab = b.dataset.goto;
        history.replaceState(null, '', `#/match/${leagueId}/${id}/${state.tab}`);
        render();
        window.scrollTo(0, 0);
      })
    );
    app.querySelectorAll('[data-inn]').forEach((b) => b.addEventListener('click', () => ((state.inn = b.dataset.inn), render())));
    app.querySelectorAll('[data-cinn]').forEach((b) => b.addEventListener('click', () => ((state.cInn = b.dataset.cinn), (state.cLimit = 60), render())));
    app.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => ((state.cFilter = b.dataset.cf), (state.cLimit = 60), render())));
    document.getElementById('more')?.addEventListener('click', () => ((state.cLimit += 100), render()));
  }

  document.title = `${state.match.name} — CricLive`;
  render();

  if (state.match.state === 'in') {
    pageTimer = setInterval(async () => {
      try {
        await load();
        if (token === routeToken) render();
      } catch {}
    }, LIVE_REFRESH_MS);
  }
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ------------------------------------------------------------------ router

const routes = [
  [/^$/, (t) => pageHome(t), 'home'],
  [/^schedule$/, (t) => pageSchedule(t, 'schedule'), 'schedule'],
  [/^results$/, (t) => pageSchedule(t, 'results'), 'results'],
  [/^series$/, (t) => pageSeriesList(t), 'series'],
  [/^series\/(\d+)$/, (t, m) => pageSeries(t, m[1]), 'series'],
  [/^match\/(\d+)\/(\d+)(?:\/(\w+))?$/, (t, m) => pageMatch(t, m[1], m[2], m[3]), ''],
  [/^teams$/, (t) => pageTeams(t), 'teams'],
  [/^team\/(\d+)$/, (t, m) => pageTeam(t, m[1]), 'teams'],
  [/^player\/(\d+)$/, (t, m) => pagePlayer(t, m[1]), ''],
  [/^news$/, (t) => pageNews(t), 'news'],
];

function router() {
  clearInterval(pageTimer);
  pageTimer = null;
  const token = ++routeToken;
  const hash = location.hash.replace(/^#\/?/, '');
  document.title = 'CricLive — International Cricket';
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    // Only scroll to top on real navigation, not on in-page tab changes.
    window.scrollTo(0, 0);
    fn(token, m).catch((e) => {
      if (token === routeToken) app.innerHTML = errorBox(e);
    });
    return;
  }
  app.innerHTML = '<div class="card empty-state">Page not found. <a href="#/">Go home</a></div>';
}

// ------------------------------------------------------------------ theme + boot

const themeBtn = document.getElementById('themeBtn');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('theme', t);
}
applyTheme(localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeBtn.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

window.addEventListener('hashchange', router);
router();
refreshTicker();
setInterval(refreshTicker, TICKER_REFRESH_MS);

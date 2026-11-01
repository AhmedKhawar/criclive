# CricLive

A personal live-score site for men's international cricket (Tests, ODIs, T20Is).

## Run

```
npm start
```

Then open http://localhost:3000. Requires Node 18+. There are no packages to install.

## Features

- **Live ticker** and **live scores** on every page, refreshing every 20–30s
- **Match centre**: live batters and bowler, this over, recent balls, full scorecard (dismissals, extras, fall of wickets, partnerships, bowling figures), ball-by-ball commentary with innings, wicket and boundary filters, playing XI and squads, match info (toss, umpires, venue, match notes), match news
- **Schedule** and **Results** grouped by date, with format filter and search
- **Series** list (ongoing, upcoming, completed) and series pages with fixtures, results and news
- **Teams** pages with recent results and upcoming fixtures
- **Player** profiles
- **News** feed
- Dark and light mode

## Data source

Data comes from ESPN's public sports API (`site.web.api.espn.com`). ESPN owns ESPNcricinfo, and this API serves the same match data. Cricinfo's own API blocks automated requests, so it isn't used. The server code (`lib/cricket.js`, started locally by `dev.js`) fetches, caches and simplifies the data. The frontend is in `public/`.

## Limitations

- The schedule covers the last 20 days and the next 40. Series pages look further.
- Player career stats and ICC rankings aren't in the free API, so player pages link to Cricinfo for full stats.
- This uses an undocumented API that can change without notice. Keep it for personal use.

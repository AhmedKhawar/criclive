# CricLive

**Live international men's cricket: scores, scorecards and ball-by-ball commentary.**

CricLive follows every men's Test, ODI and T20I being played around the world. It shows live scores, full scorecards, commentary, schedules, series and news on one fast, mobile-friendly site. There's nothing to install or configure.

🌐 **Live app:** [criclive-three.vercel.app](https://criclive-three.vercel.app)

---

## Table of Contents

- [Features](#features)
- [Match Centre](#match-centre)
- [Data Source](#data-source)
- [API Endpoints](#api-endpoints)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Limitations](#limitations)

---

## Features

- 🔴 **Live ticker** across the top of every page, refreshing every 30 seconds
- 🏏 **Live Scores** home page with live, upcoming and recent matches, plus top stories
- 📅 **Schedule & Results** grouped by date, with search by team, series or venue
- 🏆 **Series** pages listing fixtures and results, with a points table when one is available, and news
- 🌍 **Teams** pages with each team's recent results and upcoming fixtures
- 👤 **Player** profiles with role, batting and bowling style, and age
- 📰 **News** feed of the latest stories
- 🎛️ **Format filter** (Test / ODI / T20I) that's remembered between visits
- 🌗 **Light and dark themes**, with a cricket scorebook design
- 📱 **Fully responsive**, with a mobile scorecard layout like the Cricinfo app

---

## Match Centre

Every match has its own page with six tabs. While a match is live, the page refreshes every 20 seconds.

| Tab            | What it shows                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Live**       | Current batters and bowler, this over, recent balls, innings totals, key performers and the latest commentary     |
| **Scorecard**  | Batting with dismissals, extras, total, did not bat, fall of wickets, bowling figures and partnerships           |
| **Commentary** | Ball by ball with end-of-over summaries, filterable by innings, wickets only, or fours and sixes                  |
| **Squads**     | Playing XIs with roles and styles, plus full squads                                                              |
| **Match Info** | Toss, umpires and referee, match days, hours of play, venue details and match notes                              |
| **News**       | Stories about the match and series                                                                               |

---

## Data Source

All data comes from **ESPN's public sports API**. ESPN owns ESPNcricinfo, and this API serves the same match data.

- **Live scores** come from the global cricket scoreboard. Only men's internationals are kept (`internationalClassId` 1 = Test, 2 = ODI, 3 = T20I).
- **Schedule** is built by querying the scoreboard one day at a time, for the last 20 days and the next 40, and merging the results.
- **Scorecards** come from the match summary. Dismissal text such as `c Bracewell b Milne` is taken from the ball-by-ball feed.
- **Caching** is handled in memory on the server and by Vercel's CDN, so ESPN isn't hit on every page view.

No API keys or environment variables are needed.

---

## API Endpoints

The server exposes a small, clean JSON API that the frontend uses:

```
GET  /api/live                                  Matches live now and today
GET  /api/schedule                              Fixtures and results, last 20 days to next 40
GET  /api/series                                All series, grouped as ongoing, upcoming and completed
GET  /api/series/:seriesId                      Series matches, points table and news
GET  /api/match/:seriesId/:matchId              Full match: scorecard, squads, info, live state
GET  /api/match/:seriesId/:matchId/commentary   Ball-by-ball commentary, newest first
GET  /api/news                                  Latest cricket news
GET  /api/player/:playerId                      Player profile
```

### Example

```bash
curl https://criclive-three.vercel.app/api/live
```

```json
[
  {
    "id": "1539436",
    "leagueId": "24469",
    "series": "India tour of New Zealand 2026/27",
    "format": "T20I",
    "title": "5th T20I (N)",
    "state": "in",
    "summary": "New Zealand require another 46 runs with 8 wickets and 37 balls remaining",
    "teams": [
      { "name": "India", "abbr": "IND", "score": "191/8" },
      { "name": "New Zealand", "abbr": "NZ", "score": "150/2 (13.6/20 ov, target 192)" }
    ]
  }
]
```

---

## Tech Stack

| Area     | Technology                                                                              |
| -------- | --------------------------------------------------------------------------------------- |
| Frontend | Vanilla JavaScript single-page app (hash routing), hand-written CSS, no build step      |
| Backend  | Node.js (built-in `http` and `fetch`), no dependencies                                  |
| Data     | ESPN public sports API (ESPNcricinfo data)                                              |
| Hosting  | Vercel: static frontend plus one serverless function for the API, with CDN caching      |
| Fonts    | Fraunces, Inter and JetBrains Mono (Google Fonts)                                       |

---

## Project Structure

```
criclive/
├── api/
│   └── index.js      # Vercel serverless entry, routes /api/* to lib/cricket.js
├── lib/
│   └── cricket.js    # Data layer: ESPN fetching, caching, shaping, API router
├── public/
│   ├── index.html    # App shell
│   ├── main.js       # Frontend: routing, pages, live refresh
│   └── styles.css    # Scorebook theme, light/dark, responsive
├── dev.js            # Local server (static files + API)
├── vercel.json       # Vercel config (static output, rewrites, function limits)
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18 or newer

### Installation

```bash
git clone https://github.com/AhmedKhawar/criclive.git
cd criclive
```

There are no packages to install.

### Run locally

```bash
npm start
```

Then open `http://localhost:3000`.

---

## Scripts

| Command     | Description                                        |
| ----------- | -------------------------------------------------- |
| `npm start` | Start the local server on port 3000 (`PORT` to change) |

---

## Deployment

The app is set up for [Vercel](https://vercel.com) through `vercel.json`. Import the repository, keep the default settings (Framework Preset: **Other**, no build command), and deploy. There are no environment variables to add.

Each push to `main` redeploys automatically.

---

## Limitations

- **Career stats and ICC rankings** aren't in the free API, so player pages link to ESPNcricinfo for full career stats.
- **Player of the match** isn't provided as a structured field.
- **The data source is unofficial.** ESPN's API is undocumented and can change without notice.

---

## Disclaimer

CricLive is a personal, non-commercial project. It isn't affiliated with or endorsed by ESPN or ESPNcricinfo. All match data and news belong to their respective owners.

---

## Author

Built by [@AhmedKhawar](https://github.com/AhmedKhawar).

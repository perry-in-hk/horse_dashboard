# HKJC Auto Dashboard

Dockerized platform for HKJC horse-racing historical analytics, realtime upcoming race monitoring, and recommendation generation.

## Services

- `apps/backend`: Node.js API + websocket + SQL migration bootstrap
- `apps/frontend`: React dashboard for historical, realtime, and recommendation views
- `services/scraper`: Scheduled data ingestion worker (web scrape baseline + DB upsert)
- `services/recommender`: Rule-based recommendation agent worker
- `postgres` + `redis`: storage and cache layers

## Quick Start

1. Copy `.env.example` to `.env` if needed and adjust values.
2. Run:

```bash
docker compose up --build
```

3. Open:
- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/health`

Use header `x-api-key: dev-hkjc-key` for API requests.

## API Endpoints

- `GET /api/upcoming/races`
- `GET /api/history/results?limit=20`
- `GET /api/recommendations/latest`
- WebSocket: `/ws`

## Historical Scraper

Batch scraper that fetches HKJC race results (local ST/HV) via Firecrawl and stores them in the database. Requires Firecrawl CLI to be installed and authenticated (`firecrawl login --browser`).

Run all configured dates:

```bash
npm run scraper:historical
```

Filter to a date range via env vars:

```bash
SCRAPER_START_DATE=2026-01-01 SCRAPER_END_DATE=2026-01-31 npm run scraper:historical
```

Control parallelism with `SCRAPER_CONCURRENCY` (default 2).

Historical data is stored in 3 dedicated tables:

- `hkjc_race_results` — one row per horse per race (position, weight, margin, time, odds)
- `hkjc_dividends` — one row per pool+combination per race (win, place, quinella, etc.)
- `hkjc_local_race_events` — stewards/event report per horse (local races only)

## Data Schema

Core PostgreSQL tables are initialized by backend startup:

- `races`
- `horses`
- `jockeys`
- `trainers`
- `race_entries`
- `results`
- `odds_snapshots`
- `ingestion_runs`
- `recommendations`
- `hkjc_race_results`
- `hkjc_dividends`
- `hkjc_local_race_events`

## Reliability and Ops Notes

- Docker health checks configured for `postgres`, `redis`, and `backend`.
- Scraper logs each run in `ingestion_runs` with success/failure status.
- Backend uses Redis cache for hot upcoming-race query.
- Recommended DB backup command:

```bash
docker exec hkjc-postgres pg_dump -U hkjc hkjc_dashboard > backup.sql
```
# horse_inhk

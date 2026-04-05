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

Sign in through the web UI; the API uses **session cookies** (httpOnly), not a shared API key in the browser. Set `SESSION_SECRET`, `AUTH_INITIAL_USERNAME`, and `AUTH_INITIAL_PASSWORD` in `.env` when the database has no users yet (see `.env.example`).

## API Endpoints

- `GET /api/upcoming/races`
- `GET /api/history/results?limit=20`
- `GET /api/recommendations/latest`
- WebSocket: `/ws`

## Historical Scraper

Batch scraper that fetches HKJC race results (local ST/HV) via Firecrawl and stores them in the database. Requires Firecrawl CLI to be installed and authenticated (`firecrawl login --browser`).

**Default (modern mode):** scrapes only the dates in `SCRAPER_DATES` (comma-separated `YYYY-MM-DD`), or if unset, the **most recent Wednesday and Sunday strictly before today** in `Asia/Hong_Kong`. If the database already has any rows for a target date in `hkjc_race_results`, `hkjc_dividends`, or `hkjc_local_race_events`, the API/UI returns **409** and the job does not start (CLI with `SCRAPER_STRICT_NO_DUPLICATE=true` exits with an error).

```bash
SCRAPER_DATES=2026-04-02,2026-04-05 npm run scraper:historical
```

**Legacy mode** (full static date list in `services/scraper` plus optional range filters and skip-already-scraped):

```bash
SCRAPER_USE_LEGACY_TARGET_LIST=true SCRAPER_START_DATE=2026-01-01 SCRAPER_END_DATE=2026-01-31 npm run scraper:historical
```

The dashboard **Scraper** page can pass optional race dates; leaving them blank uses the same HK Wed/Sun default.

Control parallelism with `SCRAPER_CONCURRENCY` (default 2). The backend Docker image includes `services/scraper` so `/api/scraper/run` can execute `historical.js` inside the `backend` container (`SCRAPER_ROOT=/app/services/scraper` in Compose).

Historical data is stored in 3 dedicated tables:

- `hkjc_race_results` — one row per horse per race (position, weight, margin, time, odds)
- `hkjc_dividends` — one row per pool+combination per race (win, place, quinella, etc.)
- `hkjc_local_race_events` — stewards/event report per horse (local races only)

## Horse details scraper

Fetches HKJC horse profile pages and upserts `hkjc_horse_details` and `hkjc_horse_race_history`.

- **Explicit codes:** set `SCRAPER_HORSE_CODES` (comma-separated) or pass `horseCodes` from the **Scraper** UI.
- **Default (all):** if `SCRAPER_HORSE_CODES` is unset and `SCRAPER_HORSE_CODES_SOURCE` is not `file`, the code list is **`SELECT DISTINCT horse_code FROM hkjc_horse_race_history`** (excluding empty values).
- **Legacy file list:** `SCRAPER_HORSE_CODES_SOURCE=file` uses `services/scraper/horse_codes_unique.txt` (same as older CLI behavior).

Skip/resume is controlled with `SCRAPER_HORSE_DETAILS_SKIP_SCRAPED` (horses already present in `hkjc_horse_details` are skipped unless you use `--refresh` / full refresh scripts).

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

-- Active schema: historical HKJC data only (legacy operational tables removed; see schema_drop_legacy.sql)

CREATE TABLE IF NOT EXISTS hkjc_race_results (
  id SERIAL PRIMARY KEY,
  race_date DATE NOT NULL,
  racecourse TEXT NOT NULL,
  race_no INT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'local',
  horse_no INT,
  horse_name TEXT,
  horse_code TEXT,
  jockey TEXT,
  trainer TEXT,
  actual_weight INT,
  declared_weight INT,
  finish_position TEXT,
  draw INT,
  margin TEXT,
  running_positions TEXT,
  finish_time TEXT,
  win_odds NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_date, racecourse, race_no, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_hkjc_race_results_date ON hkjc_race_results(race_date);
CREATE INDEX IF NOT EXISTS idx_hkjc_race_results_horse ON hkjc_race_results(horse_code);

CREATE TABLE IF NOT EXISTS hkjc_dividends (
  id SERIAL PRIMARY KEY,
  race_date DATE NOT NULL,
  racecourse TEXT NOT NULL,
  race_no INT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'local',
  pool TEXT NOT NULL,
  combination TEXT NOT NULL,
  payout_hkd NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_date, racecourse, race_no, pool, combination)
);

CREATE INDEX IF NOT EXISTS idx_hkjc_dividends_date ON hkjc_dividends(race_date);

CREATE TABLE IF NOT EXISTS hkjc_local_race_events (
  id SERIAL PRIMARY KEY,
  race_date DATE NOT NULL,
  racecourse TEXT NOT NULL,
  race_no INT NOT NULL,
  finish_position TEXT,
  horse_no INT,
  horse_name TEXT,
  horse_code TEXT,
  event_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_date, racecourse, race_no, horse_no)
);

CREATE INDEX IF NOT EXISTS idx_hkjc_local_events_date ON hkjc_local_race_events(race_date);

-- Horse profile metadata (one row per horse)
CREATE TABLE IF NOT EXISTS hkjc_horse_details (
  horse_code TEXT PRIMARY KEY,
  horse_name TEXT,
  horseid TEXT,
  origin TEXT,
  age INT,
  color TEXT,
  sex TEXT,
  import_type TEXT,
  season_stake TEXT,
  total_stake TEXT,
  wins INT,
  seconds INT,
  thirds INT,
  total_starts INT,
  recent_runs INT,
  current_location TEXT,
  arrival_date TEXT,
  import_date TEXT,
  trainer TEXT,
  owner TEXT,
  current_rating INT,
  season_start_rating INT,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- Horse race history from horse detail page (many rows per horse)
CREATE TABLE IF NOT EXISTS hkjc_horse_race_history (
  id SERIAL PRIMARY KEY,
  horse_code TEXT NOT NULL,
  horse_name TEXT,
  season TEXT,
  race_meeting INT,
  position TEXT,
  race_date TEXT,
  venue_track TEXT,
  distance INT,
  going TEXT,
  race_class TEXT,
  draw INT,
  rating INT,
  trainer TEXT,
  jockey TEXT,
  lbw TEXT,
  win_odds NUMERIC(10,2),
  actual_weight INT,
  running_positions TEXT,
  finish_time TEXT,
  declared_weight INT,
  gear TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (horse_code, race_meeting, race_date)
);

CREATE INDEX IF NOT EXISTS idx_hkjc_horse_history_code ON hkjc_horse_race_history(horse_code);
CREATE INDEX IF NOT EXISTS idx_hkjc_horse_history_date ON hkjc_horse_race_history(race_date);

-- Parse HKJC horse history race_date text (ISO, DD/MM/YYYY, or DD/MM/YY); NULL on failure.
CREATE OR REPLACE FUNCTION hkjc_parse_history_race_date(p TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t TEXT;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  t := trim(p);
  IF t = '' THEN RETURN NULL; END IF;
  IF t ~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN t::DATE; END IF;
  IF t ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN RETURN to_date(t, 'DD/MM/YYYY'); END IF;
  IF t ~ '^\d{1,2}/\d{1,2}/\d{2}$' THEN RETURN to_date(t, 'DD/MM/YY'); END IF;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- Merged race row: results + local events + horse history.
-- Branch race_results: one row per hkjc_race_results row; at most one history row per result
-- (LATERAL LIMIT 1) to avoid duplicate result rows when multiple history rows share the same
-- (horse_code, parsed_date). Branch history_only: history rows with no matching race_results
-- row on (horse_code, parsed race_date) — e.g. overseas.
CREATE OR REPLACE VIEW hkjc_merged_race_data AS
  SELECT
    'race_results'::TEXT AS merge_source,
    r.id AS rr_id,
    r.race_date AS rr_race_date,
    r.racecourse AS rr_racecourse,
    r.race_no AS rr_race_no,
    r.source_type AS rr_source_type,
    r.horse_no AS rr_horse_no,
    r.horse_name AS rr_horse_name,
    r.horse_code AS rr_horse_code,
    r.jockey AS rr_jockey,
    r.trainer AS rr_trainer,
    r.actual_weight AS rr_actual_weight,
    r.declared_weight AS rr_declared_weight,
    r.finish_position AS rr_finish_position,
    r.draw AS rr_draw,
    r.margin AS rr_margin,
    r.running_positions AS rr_running_positions,
    r.finish_time AS rr_finish_time,
    r.win_odds AS rr_win_odds,
    r.created_at AS rr_created_at,
    e.id AS ev_id,
    e.race_date AS ev_race_date,
    e.racecourse AS ev_racecourse,
    e.race_no AS ev_race_no,
    e.finish_position AS ev_finish_position,
    e.horse_no AS ev_horse_no,
    e.horse_name AS ev_horse_name,
    e.horse_code AS ev_horse_code,
    e.event_text AS ev_event_text,
    e.created_at AS ev_created_at,
    h.id AS hist_id,
    h.horse_code AS hist_horse_code,
    h.horse_name AS hist_horse_name,
    h.season AS hist_season,
    h.race_meeting AS hist_race_meeting,
    h.position AS hist_position,
    h.race_date AS hist_race_date,
    h.venue_track AS hist_venue_track,
    h.distance AS hist_distance,
    h.going AS hist_going,
    h.race_class AS hist_race_class,
    h.draw AS hist_draw,
    h.rating AS hist_rating,
    h.trainer AS hist_trainer,
    h.jockey AS hist_jockey,
    h.lbw AS hist_lbw,
    h.win_odds AS hist_win_odds,
    h.actual_weight AS hist_actual_weight,
    h.running_positions AS hist_running_positions,
    h.finish_time AS hist_finish_time,
    h.declared_weight AS hist_declared_weight,
    h.gear AS hist_gear,
    h.created_at AS hist_created_at
  FROM hkjc_race_results r
  LEFT JOIN hkjc_local_race_events e
    ON r.race_date = e.race_date
   AND r.racecourse = e.racecourse
   AND r.race_no = e.race_no
   AND r.horse_no = e.horse_no
  LEFT JOIN LATERAL (
    SELECT hi.*
    FROM hkjc_horse_race_history hi
    WHERE r.horse_code IS NOT NULL
      AND hi.horse_code = r.horse_code
      AND hkjc_parse_history_race_date(hi.race_date) = r.race_date
    ORDER BY hi.race_meeting NULLS LAST, hi.id
    LIMIT 1
  ) h ON TRUE

  UNION ALL

  SELECT
    'history_only'::TEXT AS merge_source,
    NULL::INT AS rr_id,
    hkjc_parse_history_race_date(h.race_date) AS rr_race_date,
    NULL::TEXT AS rr_racecourse,
    NULL::INT AS rr_race_no,
    NULL::TEXT AS rr_source_type,
    NULL::INT AS rr_horse_no,
    NULL::TEXT AS rr_horse_name,
    h.horse_code AS rr_horse_code,
    NULL::TEXT AS rr_jockey,
    NULL::TEXT AS rr_trainer,
    NULL::INT AS rr_actual_weight,
    NULL::INT AS rr_declared_weight,
    NULL::TEXT AS rr_finish_position,
    NULL::INT AS rr_draw,
    NULL::TEXT AS rr_margin,
    NULL::TEXT AS rr_running_positions,
    NULL::TEXT AS rr_finish_time,
    NULL::NUMERIC(10,2) AS rr_win_odds,
    NULL::TIMESTAMPTZ AS rr_created_at,
    NULL::INT AS ev_id,
    NULL::DATE AS ev_race_date,
    NULL::TEXT AS ev_racecourse,
    NULL::INT AS ev_race_no,
    NULL::TEXT AS ev_finish_position,
    NULL::INT AS ev_horse_no,
    NULL::TEXT AS ev_horse_name,
    NULL::TEXT AS ev_horse_code,
    NULL::TEXT AS ev_event_text,
    NULL::TIMESTAMPTZ AS ev_created_at,
    h.id AS hist_id,
    h.horse_code AS hist_horse_code,
    h.horse_name AS hist_horse_name,
    h.season AS hist_season,
    h.race_meeting AS hist_race_meeting,
    h.position AS hist_position,
    h.race_date AS hist_race_date,
    h.venue_track AS hist_venue_track,
    h.distance AS hist_distance,
    h.going AS hist_going,
    h.race_class AS hist_race_class,
    h.draw AS hist_draw,
    h.rating AS hist_rating,
    h.trainer AS hist_trainer,
    h.jockey AS hist_jockey,
    h.lbw AS hist_lbw,
    h.win_odds AS hist_win_odds,
    h.actual_weight AS hist_actual_weight,
    h.running_positions AS hist_running_positions,
    h.finish_time AS hist_finish_time,
    h.declared_weight AS hist_declared_weight,
    h.gear AS hist_gear,
    h.created_at AS hist_created_at
  FROM hkjc_horse_race_history h
  WHERE NOT EXISTS (
    SELECT 1
    FROM hkjc_race_results r
    WHERE r.horse_code = h.horse_code
      AND hkjc_parse_history_race_date(h.race_date) IS NOT NULL
      AND r.race_date = hkjc_parse_history_race_date(h.race_date)
  );

-- Live odds snapshots from HKJC GraphQL (worker poll + hash dedup)
CREATE TABLE IF NOT EXISTS hkjc_odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meeting_date DATE NOT NULL,
  venue_code TEXT NOT NULL,
  race_no INT NOT NULL,
  odds_types TEXT[] NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'hkjc_graphql'
);

CREATE INDEX IF NOT EXISTS idx_hkjc_odds_snapshots_lookup
  ON hkjc_odds_snapshots (meeting_date, venue_code, race_no, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_hkjc_odds_snapshots_dedup
  ON hkjc_odds_snapshots (meeting_date, venue_code, race_no, odds_types);

-- AI race analysis snapshots (persisted for review; one row per successful /api/ai/analyze)
CREATE TABLE IF NOT EXISTS hkjc_ai_analyses (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meeting_date DATE NOT NULL,
  venue_code TEXT NOT NULL,
  race_no INT NOT NULL,
  output_format TEXT NOT NULL,
  markdown_text TEXT NOT NULL,
  structured_json JSONB,
  model TEXT,
  usage_json JSONB,
  meta_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hkjc_ai_analyses_race_time
  ON hkjc_ai_analyses (meeting_date, venue_code, race_no, created_at DESC);

-- Dashboard identities (session rows are created by connect-pg-simple when createTableIfMissing runs)
CREATE TABLE IF NOT EXISTS dashboard_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  keycloak_sub TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dashboard_users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS keycloak_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_users_keycloak_sub
  ON dashboard_users (keycloak_sub)
  WHERE keycloak_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_users_username ON dashboard_users (username);

CREATE TABLE IF NOT EXISTS dashboard_audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  username TEXT,
  user_id INT REFERENCES dashboard_users(id) ON DELETE SET NULL,
  ip TEXT,
  user_agent TEXT,
  detail JSONB
);

CREATE INDEX IF NOT EXISTS idx_dashboard_audit_log_created
  ON dashboard_audit_log (created_at DESC);

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

import pg from "pg";

const { Pool } = pg;
let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool() {
  if (pool) await pool.end();
}

/**
 * Upsert one race result row.
 */
export async function upsertRaceResult(raceDate, racecourse, raceNo, sourceType, row) {
  const p = getPool();
  await p.query(
    `INSERT INTO hkjc_race_results
       (race_date, racecourse, race_no, source_type,
        horse_no, horse_name, horse_code, jockey, trainer,
        actual_weight, declared_weight, finish_position,
        draw, margin, running_positions, finish_time, win_odds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (race_date, racecourse, race_no, horse_no)
     DO UPDATE SET
       horse_name      = EXCLUDED.horse_name,
       horse_code      = EXCLUDED.horse_code,
       jockey          = EXCLUDED.jockey,
       trainer         = EXCLUDED.trainer,
       actual_weight   = EXCLUDED.actual_weight,
       declared_weight = EXCLUDED.declared_weight,
       finish_position = EXCLUDED.finish_position,
       draw            = EXCLUDED.draw,
       margin          = EXCLUDED.margin,
       running_positions = EXCLUDED.running_positions,
       finish_time     = EXCLUDED.finish_time,
       win_odds        = EXCLUDED.win_odds`,
    [
      raceDate, racecourse, raceNo, sourceType,
      row.horse_no, row.horse_name, row.horse_code, row.jockey, row.trainer,
      row.actual_weight, row.declared_weight, row.finish_position,
      row.draw, row.margin, row.running_positions, row.finish_time, row.win_odds,
    ]
  );
}

/**
 * Upsert one dividend row.
 */
export async function upsertDividend(raceDate, racecourse, raceNo, sourceType, row) {
  const p = getPool();
  await p.query(
    `INSERT INTO hkjc_dividends
       (race_date, racecourse, race_no, source_type, pool, combination, payout_hkd)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (race_date, racecourse, race_no, pool, combination)
     DO UPDATE SET payout_hkd = EXCLUDED.payout_hkd`,
    [raceDate, racecourse, raceNo, sourceType, row.pool, row.combination, row.payout_hkd]
  );
}

/**
 * Upsert one local race event row.
 */
export async function upsertLocalRaceEvent(raceDate, racecourse, raceNo, row) {
  const p = getPool();
  await p.query(
    `INSERT INTO hkjc_local_race_events
       (race_date, racecourse, race_no, finish_position,
        horse_no, horse_name, horse_code, event_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (race_date, racecourse, race_no, horse_no)
     DO UPDATE SET
       finish_position = EXCLUDED.finish_position,
       horse_name      = EXCLUDED.horse_name,
       horse_code      = EXCLUDED.horse_code,
       event_text      = EXCLUDED.event_text`,
    [
      raceDate, racecourse, raceNo,
      row.finish_position, row.horse_no, row.horse_name, row.horse_code, row.event_text,
    ]
  );
}

/**
 * Upsert one horse detail (profile) row.
 */
export async function upsertHorseDetail(horseid, row) {
  const p = getPool();
  await p.query(
    `INSERT INTO hkjc_horse_details
       (horse_code, horse_name, horseid, origin, age, color, sex,
        import_type, season_stake, total_stake, wins, seconds, thirds,
        total_starts, recent_runs, current_location, arrival_date,
        import_date, trainer, owner, current_rating, season_start_rating,
        scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
     ON CONFLICT (horse_code)
     DO UPDATE SET
       horse_name          = EXCLUDED.horse_name,
       horseid             = EXCLUDED.horseid,
       origin              = EXCLUDED.origin,
       age                 = EXCLUDED.age,
       color               = EXCLUDED.color,
       sex                 = EXCLUDED.sex,
       import_type         = EXCLUDED.import_type,
       season_stake        = EXCLUDED.season_stake,
       total_stake         = EXCLUDED.total_stake,
       wins                = EXCLUDED.wins,
       seconds             = EXCLUDED.seconds,
       thirds              = EXCLUDED.thirds,
       total_starts        = EXCLUDED.total_starts,
       recent_runs         = EXCLUDED.recent_runs,
       current_location    = EXCLUDED.current_location,
       arrival_date        = EXCLUDED.arrival_date,
       import_date         = EXCLUDED.import_date,
       trainer             = EXCLUDED.trainer,
       owner               = EXCLUDED.owner,
       current_rating      = EXCLUDED.current_rating,
       season_start_rating = EXCLUDED.season_start_rating,
       scraped_at          = NOW()`,
    [
      row.horse_code, row.horse_name, horseid,
      row.origin ?? null, row.age ?? null, row.color ?? null, row.sex ?? null,
      row.import_type ?? null, row.season_stake ?? null, row.total_stake ?? null,
      row.wins ?? null, row.seconds ?? null, row.thirds ?? null,
      row.total_starts ?? null, row.recent_runs ?? null,
      row.current_location ?? null, row.arrival_date ?? null,
      row.import_date ?? null, row.trainer ?? null, row.owner ?? null,
      row.current_rating ?? null, row.season_start_rating ?? null,
    ]
  );
}

/**
 * Upsert one horse race history row.
 */
export async function upsertHorseRaceHistory(horseCode, horseName, row) {
  const p = getPool();
  await p.query(
    `INSERT INTO hkjc_horse_race_history
       (horse_code, horse_name, season, race_meeting, position, race_date,
        venue_track, distance, going, race_class, draw, rating,
        trainer, jockey, lbw, win_odds, actual_weight,
        running_positions, finish_time, declared_weight, gear)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (horse_code, race_meeting, race_date)
     DO UPDATE SET
       horse_name        = EXCLUDED.horse_name,
       season            = EXCLUDED.season,
       position          = EXCLUDED.position,
       venue_track       = EXCLUDED.venue_track,
       distance          = EXCLUDED.distance,
       going             = EXCLUDED.going,
       race_class        = EXCLUDED.race_class,
       draw              = EXCLUDED.draw,
       rating            = EXCLUDED.rating,
       trainer           = EXCLUDED.trainer,
       jockey            = EXCLUDED.jockey,
       lbw               = EXCLUDED.lbw,
       win_odds          = EXCLUDED.win_odds,
       actual_weight     = EXCLUDED.actual_weight,
       running_positions = EXCLUDED.running_positions,
       finish_time       = EXCLUDED.finish_time,
       declared_weight   = EXCLUDED.declared_weight,
       gear              = EXCLUDED.gear`,
    [
      horseCode, horseName, row.season, row.race_meeting, row.position, row.race_date,
      row.venue_track, row.distance, row.going, row.race_class, row.draw, row.rating,
      row.trainer, row.jockey, row.lbw, row.win_odds, row.actual_weight,
      row.running_positions, row.finish_time, row.declared_weight, row.gear,
    ]
  );
}

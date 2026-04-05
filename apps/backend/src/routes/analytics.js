import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * Unified race row from hkjc_merged_race_data (local results + events + horse history).
 * Prefer rr_* (official results); fill from hist_* for history_only / overseas rows.
 */
const MERGED_RACE_FLAT = `
  SELECT
    m.merge_source,
    COALESCE(m.rr_race_date, hkjc_parse_history_race_date(m.hist_race_date)) AS race_date,
    COALESCE(m.rr_racecourse, m.hist_venue_track) AS racecourse,
    m.rr_race_no AS race_no,
    COALESCE(m.rr_horse_code, m.hist_horse_code) AS horse_code,
    COALESCE(m.rr_horse_name, m.hist_horse_name) AS horse_name,
    COALESCE(m.rr_jockey, m.hist_jockey) AS jockey,
    COALESCE(m.rr_trainer, m.hist_trainer) AS trainer,
    COALESCE(m.rr_finish_position, m.hist_position) AS finish_position,
    COALESCE(m.rr_finish_time, m.hist_finish_time) AS finish_time,
    COALESCE(m.rr_win_odds, m.hist_win_odds) AS win_odds,
    COALESCE(m.rr_draw, m.hist_draw) AS draw,
    COALESCE(m.rr_actual_weight, m.hist_actual_weight) AS actual_weight,
    COALESCE(m.rr_declared_weight, m.hist_declared_weight) AS declared_weight,
    COALESCE(m.rr_margin, m.hist_lbw) AS margin,
    COALESCE(m.rr_running_positions, m.hist_running_positions) AS running_positions,
    m.hist_distance AS race_distance,
    m.hist_finish_time AS hist_finish_time
  FROM hkjc_merged_race_data m
`;

/**
 * Derived per-race score: inverted placement (14 - pos) blended with market
 * signal (100 / win_odds).  Transparent placeholder until a proper Part-I
 * ranking pipeline is wired in.
 */
function deriveRaceScore(posInt, winOdds) {
  const placementPts = posInt != null ? Math.max(0, 14 - posInt) : 0;
  const marketPts = winOdds ? 100 / winOdds : 0;
  return Math.round((placementPts * 0.6 + marketPts * 0.4) * 100) / 100;
}

function parsePositionInt(raw) {
  if (raw == null) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * HKJC finish time: "1:09.45" (min:sec.decimals), "1:42:03" (min:sec:hundredths),
 * or plain seconds. Do not join segments with parseFloat — "01:65" would parse as 1.
 */
function parseFinishTimeSeconds(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.trim());
    if (parts.length < 2) return null;
    const mins = parseInt(parts[0], 10);
    if (!Number.isFinite(mins)) return null;
    if (parts.length === 2) {
      const sec = parseFloat(parts[1]);
      if (!Number.isFinite(sec)) return null;
      const t = mins * 60 + sec;
      return t > 0 ? t : null;
    }
    const secInt = parseInt(parts[1], 10);
    const hundredths = parseInt(parts[2], 10);
    if (!Number.isFinite(secInt) || !Number.isFinite(hundredths)) return null;
    const t = mins * 60 + secInt + hundredths / 100;
    return t > 0 ? t : null;
  }
  const t = parseFloat(s);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** m/s; drop obvious garbage if parser or upstream data slips through. */
function plausibleSpeedMps(speed) {
  if (speed == null || !Number.isFinite(speed)) return null;
  if (speed < 4 || speed > 35) return null;
  return speed;
}

// ---- Horse list (dropdown; must be before /horses/:horseCode/history) -------

router.get("/horses/list", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 5000), 1), 8000);
  const { rows } = await pool.query(
    `SELECT horse_code, horse_name, COUNT(*)::int AS race_count
     FROM (${MERGED_RACE_FLAT}) AS mr
     WHERE horse_code IS NOT NULL AND horse_name IS NOT NULL
     GROUP BY horse_code, horse_name
     ORDER BY horse_name ASC, horse_code ASC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
});

// ---- Horse history (time-ordered) -------------------------------------------

router.get("/horses/:horseCode/history", async (req, res) => {
  const { horseCode } = req.params;
  const { rows } = await pool.query(
    `SELECT race_date, racecourse, race_no, horse_name, horse_code, jockey,
            trainer, finish_position, finish_time, win_odds, draw,
            actual_weight, declared_weight, margin, running_positions
     FROM (${MERGED_RACE_FLAT}) AS mr
     WHERE horse_code = $1
     ORDER BY race_date, race_no NULLS LAST`,
    [horseCode.toUpperCase()]
  );

  const enriched = rows.map((r) => {
    const posInt = parsePositionInt(r.finish_position);
    return {
      ...r,
      position_int: posInt,
      race_score: deriveRaceScore(posInt, r.win_odds ? Number(r.win_odds) : null),
    };
  });

  res.json(enriched);
});

// ---- Runners for a specific race --------------------------------------------

router.get("/race/:date/:course/:raceNo/runners", async (req, res) => {
  const { date, course, raceNo } = req.params;
  const { rows } = await pool.query(
    `SELECT horse_no, horse_name, horse_code, jockey, trainer,
            finish_position, finish_time, win_odds, draw,
            actual_weight, declared_weight, margin, running_positions
     FROM hkjc_race_results
     WHERE race_date = $1 AND racecourse = $2 AND race_no = $3
     ORDER BY horse_no`,
    [date, course.toUpperCase(), Number(raceNo)]
  );

  const enriched = rows.map((r) => {
    const posInt = parsePositionInt(r.finish_position);
    return {
      ...r,
      position_int: posInt,
      race_score: deriveRaceScore(posInt, r.win_odds ? Number(r.win_odds) : null),
    };
  });

  res.json(enriched);
});

// ---- Horse search (autocomplete helper) -------------------------------------

router.get("/horses/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);

  const { rows } = await pool.query(
    `SELECT DISTINCT horse_code, horse_name,
            COUNT(*) OVER (PARTITION BY horse_code) AS race_count
     FROM (${MERGED_RACE_FLAT}) AS mr
     WHERE horse_name ILIKE $1 OR horse_code ILIKE $1
     ORDER BY horse_name
     LIMIT 30`,
    [`%${q}%`]
  );
  res.json(rows);
});

// ---- Jockey performance aggregates ------------------------------------------

router.get("/jockey-performance", async (req, res) => {
  const minRaces = Number(req.query.min_races ?? 10);
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const { rows } = await pool.query(
    `WITH jstats AS (
       SELECT jockey,
              COUNT(*)::int AS total_races,
              COUNT(*) FILTER (WHERE finish_position = '1')::int AS wins,
              COUNT(*) FILTER (WHERE finish_position IN ('1','2','3'))::int AS top3,
              ROUND(AVG(CASE WHEN win_odds IS NOT NULL THEN win_odds END), 2) AS avg_win_odds
       FROM (${MERGED_RACE_FLAT}) AS mr
       WHERE jockey IS NOT NULL AND trim(jockey) <> ''
       GROUP BY jockey
       HAVING COUNT(*) >= $1
     )
     SELECT jockey, total_races, wins, top3,
            ROUND(wins::numeric / total_races * 100, 2) AS win_rate,
            ROUND(top3::numeric / total_races * 100, 2) AS top3_rate,
            avg_win_odds
     FROM jstats
     ORDER BY win_rate DESC
     LIMIT $2`,
    [minRaces, limit]
  );
  res.json(rows);
});

// ---- Jockey time-series (per-date rolling stats) ----------------------------

router.get("/jockey/:name/history", async (req, res) => {
  const { name } = req.params;
  const { rows } = await pool.query(
    `SELECT race_date, racecourse, race_no, horse_name, horse_code,
            finish_position, win_odds, finish_time
     FROM hkjc_race_results
     WHERE jockey = $1
     ORDER BY race_date, race_no`,
    [name]
  );

  const enriched = rows.map((r) => {
    const posInt = parsePositionInt(r.finish_position);
    return { ...r, position_int: posInt, race_score: deriveRaceScore(posInt, r.win_odds ? Number(r.win_odds) : null) };
  });
  res.json(enriched);
});

// ---- Compare: multi-horse side-by-side --------------------------------------

router.get("/horses/compare", async (req, res) => {
  const raw = String(req.query.codes ?? "");
  const codes = raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0 || codes.length > 14) {
    return res.status(400).json({ error: "Provide 1–14 comma-separated horse codes" });
  }

  const { rows } = await pool.query(
    `SELECT race_date, racecourse, race_no, horse_name, horse_code, jockey,
            trainer, finish_position, finish_time, win_odds, draw,
            actual_weight, declared_weight, margin, running_positions, race_distance,
            hist_finish_time
     FROM (${MERGED_RACE_FLAT}) AS mr
     WHERE horse_code = ANY($1::text[])
     ORDER BY horse_code, race_date, race_no NULLS LAST`,
    [codes]
  );

  const grouped = new Map();
  for (const r of rows) {
    const posInt = parsePositionInt(r.finish_position);
    const dist = r.race_distance != null ? Number(r.race_distance) : null;
    const histTimeRaw = r.hist_finish_time;
    const hasHistSpeed =
      histTimeRaw != null &&
      String(histTimeRaw).trim() !== "" &&
      dist != null &&
      dist > 0;
    const timeSeconds = hasHistSpeed ? parseFinishTimeSeconds(histTimeRaw) : null;
    const rawSpeed =
      hasHistSpeed && timeSeconds != null && timeSeconds > 0
        ? Math.round((dist / timeSeconds) * 10000) / 10000
        : null;
    const speedMps = plausibleSpeedMps(rawSpeed);
    const enriched = {
      ...r,
      race_distance: dist,
      time_seconds: speedMps != null ? timeSeconds : null,
      speed_mps: speedMps,
      position_int: posInt,
      race_score: deriveRaceScore(posInt, r.win_odds ? Number(r.win_odds) : null),
    };
    const code = r.horse_code;
    if (!grouped.has(code)) grouped.set(code, { horse_code: code, horse_name: r.horse_name, rows: [] });
    grouped.get(code).rows.push(enriched);
  }

  const horses = codes
    .map((code) => grouped.get(code))
    .filter(Boolean)
    .map((h) => {
      const r = h.rows;
      const positions = r.map((x) => x.position_int).filter((p) => p != null);
      const odds = r.map((x) => (x.win_odds != null ? Number(x.win_odds) : null)).filter((o) => o != null);
      const scores = r.map((x) => x.race_score);
      const wins = positions.filter((p) => p === 1).length;
      const top3 = positions.filter((p) => p <= 3).length;

      // Draw distribution
      const draws = r.map((x) => x.draw).filter((d) => d != null);
      const avgDraw = draws.length ? Math.round((draws.reduce((s, d) => s + d, 0) / draws.length) * 100) / 100 : null;

      // Venue split
      const byCourse = {};
      for (const x of r) {
        const c = x.racecourse;
        if (!byCourse[c]) byCourse[c] = { starts: 0, wins: 0 };
        byCourse[c].starts++;
        if (x.position_int === 1) byCourse[c].wins++;
      }

      return {
        ...h,
        summary: {
          starts: r.length,
          wins,
          top3,
          win_rate: r.length ? Math.round((wins / r.length) * 10000) / 100 : 0,
          top3_rate: r.length ? Math.round((top3 / r.length) * 10000) / 100 : 0,
          avg_position: positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 100) / 100 : null,
          avg_odds: odds.length ? Math.round((odds.reduce((s, o) => s + o, 0) / odds.length) * 100) / 100 : null,
          avg_score: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100 : 0,
          avg_draw: avgDraw,
          venue_split: byCourse,
        },
      };
    });

  res.json({ horses });
});

// ---- Meta: distinct race dates + meetings -----------------------------------

router.get("/meta/race-dates", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT race_date, racecourse, COUNT(DISTINCT race_no)::int AS race_count
     FROM hkjc_race_results
     GROUP BY race_date, racecourse
     ORDER BY race_date DESC
     LIMIT 500`
  );
  res.json(rows);
});

// ---- Meta: overview stats ---------------------------------------------------

router.get("/meta/overview", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(DISTINCT race_date)::int AS total_race_days,
       COUNT(DISTINCT (race_date, racecourse, race_no))::int AS total_races,
       COUNT(DISTINCT horse_code)::int AS total_horses,
       COUNT(DISTINCT jockey)::int AS total_jockeys,
       MIN(race_date) AS earliest_date,
       MAX(race_date) AS latest_date
     FROM hkjc_race_results`
  );
  res.json(rows[0] ?? {});
});

export { MERGED_RACE_FLAT, deriveRaceScore, parsePositionInt };
export default router;

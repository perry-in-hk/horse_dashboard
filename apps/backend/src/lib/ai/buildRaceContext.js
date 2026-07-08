import { MERGED_RACE_FLAT, deriveRaceScore, parsePositionInt } from "../../routes/analytics.js";

const DEFAULT_PAIR_LINES = 40;
const DEFAULT_POOL_LINES = 24;

function normalizePoolsPayload(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

function parseOddsNum(v) {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** @returns {Record<string, { comb: string, odds: number }[]>} */
function collectPoolLines(pmPools) {
  const pools = normalizePoolsPayload(pmPools);
  /** @type {Record<string, { comb: string, odds: number }[]>} */
  const out = {};
  for (const p of pools) {
    const t = String(p.oddsType ?? "").toUpperCase().trim();
    if (!t) continue;
    const rows = [];
    for (const n of p.oddsNodes ?? []) {
      const comb = String(n.combString ?? "").trim();
      const odds = parseOddsNum(n.oddsValue);
      if (!comb || odds == null) continue;
      rows.push({ comb, odds });
    }
    rows.sort((a, b) => a.odds - b.odds);
    out[t] = rows;
  }
  return out;
}

/**
 * @returns {{
 *  win: Record<string, number>,
 *  pla: Record<string, number>,
 *  qin: { comb: string, odds: number }[],
 *  qpl: { comb: string, odds: number }[],
 *  qin_truncated: boolean,
 *  qpl_truncated: boolean,
 *  allPools: Record<string, { comb: string, odds: number }[]>
 * }}
 */
function summarizePools(pmPools, pairLimit = DEFAULT_PAIR_LINES, poolLimit = DEFAULT_POOL_LINES) {
  const poolMap = collectPoolLines(pmPools);
  const win = {};
  const pla = {};
  for (const row of poolMap.WIN ?? []) win[row.comb] = row.odds;
  for (const row of poolMap.PLA ?? []) pla[row.comb] = row.odds;

  const qinRaw = poolMap.QIN ?? [];
  const qplRaw = poolMap.QPL ?? [];

  /** @type {Record<string, { comb: string, odds: number }[]>} */
  const allPools = {};
  for (const [poolCode, rows] of Object.entries(poolMap)) {
    allPools[poolCode] = rows.slice(0, poolLimit);
  }

  return {
    win,
    pla,
    qin: qinRaw.slice(0, pairLimit),
    qpl: qplRaw.slice(0, pairLimit),
    qin_truncated: qinRaw.length > pairLimit,
    qpl_truncated: qplRaw.length > pairLimit,
    allPools,
  };
}

function winOddsFromRacecardRace(race) {
  const win = {};
  const pla = {};
  for (const ru of race?.runners ?? []) {
    const no = parseInt(String(ru?.no ?? "").trim(), 10);
    if (!Number.isFinite(no)) continue;
    const key = String(no);
    const w = parseOddsNum(ru?.winOdds);
    if (w != null) win[key] = w;
    const p = parseOddsNum(ru?.placeOdds ?? ru?.plaOdds);
    if (p != null) pla[key] = p;
  }
  return { win, pla };
}

export async function loadLatestSnapshotPayload(db, meetingDate, venueCode, raceNo) {
  const r = await db.query(
    `SELECT payload, observed_at
     FROM hkjc_odds_snapshots
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
     ORDER BY observed_at DESC
     LIMIT 1`,
    [meetingDate, venueCode, raceNo]
  );
  return r.rows[0] ?? null;
}

export async function loadRecentFormRows(db, horseCodes, capPerHorse) {
  const codes = horseCodes.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return [];

  const { rows } = await db.query(
    `WITH ranked AS (
       SELECT mr.race_date, mr.racecourse, mr.race_no, mr.horse_code, mr.horse_name,
              mr.jockey, mr.trainer, mr.finish_position, mr.finish_time, mr.win_odds, mr.draw,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(mr.horse_code, '')
                ORDER BY COALESCE(mr.race_date, DATE '1900-01-01') DESC, mr.race_no DESC NULLS LAST
              ) AS rn
       FROM (${MERGED_RACE_FLAT}) AS mr
       WHERE mr.horse_code = ANY($1::text[])
     )
     SELECT race_date, racecourse, race_no, horse_code, horse_name, jockey, trainer,
            finish_position, finish_time, win_odds, draw
     FROM ranked WHERE rn <= $2
     ORDER BY horse_code, race_date DESC, race_no DESC NULLS LAST`,
    [codes, capPerHorse]
  );

  return rows.map((row) => {
    const posInt = parsePositionInt(row.finish_position);
    const wo = row.win_odds != null ? Number(row.win_odds) : null;
    return {
      ...row,
      race_score: deriveRaceScore(posInt, wo),
    };
  });
}

export function groupFormByHorse(rows, runners) {
  const nameByCode = new Map(runners.map((r) => [r.horse_code.toUpperCase(), r.horse_name]));
  const map = new Map();
  for (const r of rows) {
    const code = r.horse_code?.toUpperCase();
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, {
        horse_code: code,
        horse_name: nameByCode.get(code) ?? r.horse_name ?? code,
        rows: [],
      });
    }
    map.get(code).rows.push(r);
  }
  for (const ru of runners) {
    const c = ru.horse_code.toUpperCase();
    if (!map.has(c)) {
      map.set(c, { horse_code: c, horse_name: ru.horse_name, rows: [] });
    }
  }
  return runners.map(
    (ru) => map.get(ru.horse_code.toUpperCase()) ?? { horse_code: ru.horse_code, horse_name: ru.horse_name, rows: [] }
  );
}

/**
 * Build shared race context for AI routes (legacy analyze and council).
 * @param {import("pg").Pool} db
 * @param {{
 *  meeting_date: string,
 *  venue_code: string,
 *  race_no: number,
 *  runners: { horse_code: string, horse_name: string }[],
 *  racecardRace?: unknown,
 *  formRowsPerHorse: number,
 *  focusFormRowsPerHorse: number,
 *  focused?: boolean,
 *  pairLimit?: number,
 *  poolLimit?: number
 * }} p
 */
export async function buildRaceContext(db, p) {
  const {
    meeting_date,
    venue_code,
    race_no,
    runners,
    racecardRace,
    formRowsPerHorse,
    focusFormRowsPerHorse,
    focused = false,
    pairLimit = DEFAULT_PAIR_LINES,
    poolLimit = DEFAULT_POOL_LINES,
  } = p;

  const snap = await loadLatestSnapshotPayload(db, meeting_date, venue_code, race_no);

  let oddsSummary = { source: "none", observed_at: null, win: {}, pla: {} };
  let pairPools = { source: "none", observed_at: null, qin: [], qpl: [], qin_truncated: false, qpl_truncated: false };
  /** @type {{ source: string, observed_at: string | null, pools: Record<string, { comb: string, odds: number }[]> }} */
  let allPools = { source: "none", observed_at: null, pools: {} };

  if (snap?.payload) {
    const observedAt = snap.observed_at ? new Date(snap.observed_at).toISOString() : null;
    const summarized = summarizePools(snap.payload, pairLimit, poolLimit);
    if (Object.keys(summarized.win).length || Object.keys(summarized.pla).length) {
      oddsSummary = {
        source: "snapshot",
        observed_at: observedAt,
        win: summarized.win,
        pla: summarized.pla,
      };
    }
    pairPools = {
      source: "snapshot",
      observed_at: observedAt,
      qin: summarized.qin,
      qpl: summarized.qpl,
      qin_truncated: summarized.qin_truncated,
      qpl_truncated: summarized.qpl_truncated,
    };
    allPools = {
      source: "snapshot",
      observed_at: observedAt,
      pools: summarized.allPools,
    };
  }

  if (oddsSummary.source === "none") {
    const race = racecardRace ?? null;
    const { win, pla } = winOddsFromRacecardRace(race);
    if (Object.keys(win).length || Object.keys(pla).length) {
      oddsSummary = { source: "racecard", observed_at: null, win, pla };
    }
  }

  const cap = focused ? focusFormRowsPerHorse : formRowsPerHorse;
  const formRows = await loadRecentFormRows(
    db,
    runners.map((r) => r.horse_code),
    cap
  );
  const formByHorse = groupFormByHorse(formRows, runners);

  return {
    snapshot: snap,
    oddsSummary,
    pairPools,
    allPools,
    formByHorse,
  };
}


import { pool } from "./db.js";
import { getHorseRacingApi, mergePayloadWithRunnerFallback } from "./lib/hkjcOddsClient.js";
import { insertSnapshotIfChanged } from "./lib/oddsSnapshot.js";
import {
  beginSyncExclusive,
  clearActiveIntervalTarget,
  clearCurrentSync,
  endSyncExclusive,
  getActiveIntervalTargets,
  setActiveIntervalTargets,
  setCurrentSync,
} from "./lib/oddsWorkerRuntime.js";
import { getWorkerIntervalMs } from "./lib/realtimeSettings.js";
import { recordSyncResult } from "./lib/syncState.js";

function oddsSyncDisabled() {
  return process.env.ODDS_SYNC_ENABLED === "false";
}

function legacyFullInterval() {
  return process.env.ODDS_SYNC_LEGACY_FULL_INTERVAL === "true";
}

function parseOddsTypesFromEnv() {
  const raw = process.env.ODDS_SYNC_ODDS_TYPES ?? "WIN,PLA";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].sort();
}

/**
 * @param {{ status?: string }} race
 */
function shouldSkipRace(race) {
  const s = String(race?.status ?? "").toUpperCase();
  if (!s) return false;
  const skip = ["RESULT", "CLOSED", "CANCELLED", "ABANDONED", "VOID", "RACE_RESULT"];
  return skip.some((k) => s.includes(k));
}

/** @param {unknown[]} meetings */
function findRaceInMeetings(meetings, meetingDate, venueCode, raceNo) {
  for (const m of meetings) {
    const d = String(m.date).slice(0, 10);
    if (d !== meetingDate) continue;
    if (String(m.venueCode) !== String(venueCode)) continue;
    for (const race of m.races ?? []) {
      if (parseInt(String(race.no), 10) === raceNo) return race;
    }
  }
  return null;
}

/**
 * One race: latest odds from HKJC, insert if changed.
 * @param {{ meetingDate: string; venueCode: string; raceNo: number }} p
 */
export async function runOddsSyncSingleRace(p) {
  const { meetingDate, venueCode, raceNo } = p;
  const api = getHorseRacingApi();
  const oddsTypes = parseOddsTypesFromEnv();
  const meetings = await api.getActiveMeetings();

  if (meetings?.length) {
    const raceMeta = findRaceInMeetings(meetings, meetingDate, venueCode, raceNo);
    if (raceMeta && shouldSkipRace(raceMeta)) {
      const empty = { meetings: 0, racesChecked: 0, inserted: 0, skipped: true };
      recordSyncResult(empty);
      return empty;
    }
  }

  setCurrentSync({ kind: "interval", meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo });
  try {
    let pmPools = await api.getRaceOddsWithDateAndVenueCode(meetingDate, venueCode, raceNo, oddsTypes);
    pmPools = await mergePayloadWithRunnerFallback(pmPools, meetingDate, venueCode, raceNo, oddsTypes);
    const r = await insertSnapshotIfChanged(pool, {
      meetingDate,
      venueCode,
      raceNo,
      oddsTypes,
      payload: pmPools,
    });
    const inserted = r.inserted ? 1 : 0;
    const summary = { meetings: 1, racesChecked: 1, inserted };
    recordSyncResult(summary);
    return summary;
  } finally {
    clearCurrentSync();
  }
}

/**
 * Full sweep: all active meetings and races (one-shot or legacy interval).
 */
export async function runOddsSyncAllActiveMeetings() {
  if (!beginSyncExclusive()) {
    const err = new Error("Odds sync already in progress");
    err.code = "EBUSY";
    throw err;
  }
  try {
    return await runOddsSyncAllActiveMeetingsBody();
  } finally {
    endSyncExclusive();
    clearCurrentSync();
  }
}

async function runOddsSyncAllActiveMeetingsBody() {
  const api = getHorseRacingApi();
  const oddsTypes = parseOddsTypesFromEnv();
  const meetings = await api.getActiveMeetings();
  if (!meetings?.length) {
    const empty = { meetings: 0, racesChecked: 0, inserted: 0 };
    recordSyncResult(empty);
    return empty;
  }

  let inserted = 0;
  let racesChecked = 0;

  for (const m of meetings) {
    const date = String(m.date).slice(0, 10);
    const venueCode = String(m.venueCode);
    const races = m.races ?? [];

    for (const race of races) {
      if (shouldSkipRace(race)) continue;
      const raceNo = parseInt(String(race.no), 10);
      if (!Number.isFinite(raceNo)) continue;
      racesChecked += 1;

      setCurrentSync({ kind: "full", meeting_date: date, venue_code: venueCode, race_no: raceNo });
      try {
        let pmPools = await api.getRaceOddsWithDateAndVenueCode(date, venueCode, raceNo, oddsTypes);
        pmPools = await mergePayloadWithRunnerFallback(pmPools, date, venueCode, raceNo, oddsTypes);

        const r = await insertSnapshotIfChanged(pool, {
          meetingDate: date,
          venueCode,
          raceNo,
          oddsTypes,
          payload: pmPools,
        });
        if (r.inserted) inserted += 1;
      } finally {
        clearCurrentSync();
      }
    }
  }

  const summary = { meetings: meetings.length, racesChecked, inserted };
  recordSyncResult(summary);
  return summary;
}

/** @deprecated Use runOddsSyncAllActiveMeetings */
export const runOddsSyncOnce = runOddsSyncAllActiveMeetings;

let timeoutId = null;
let stopped = false;

async function runIntervalTickWork() {
  if (legacyFullInterval()) {
    if (!beginSyncExclusive()) return;
    try {
      await runOddsSyncAllActiveMeetingsBody();
    } catch (err) {
      console.error("[oddsSync]", err);
      recordSyncResult(null, err);
    } finally {
      endSyncExclusive();
      clearCurrentSync();
    }
    return;
  }

  const targets = getActiveIntervalTargets();
  if (!targets.length) return;

  if (!beginSyncExclusive()) return;
  try {
    let inserted = 0;
    for (const target of targets) {
      const r = await runOddsSyncSingleRace({
        meetingDate: target.meeting_date,
        venueCode: target.venue_code,
        raceNo: target.race_no,
      });
      inserted += r.inserted ?? 0;
    }
    if (inserted > 0) {
      console.log(`[oddsSync] interval inserted ${inserted} snapshot(s) across ${targets.length} race(s)`);
    }
  } catch (err) {
    console.error("[oddsSync]", err);
    recordSyncResult(null, err);
  } finally {
    endSyncExclusive();
    clearCurrentSync();
  }
}

/**
 * @param {number} [initialDelayMs] first delay; subsequent ticks use worker interval
 */
function scheduleNext(initialDelayMs) {
  if (stopped || oddsSyncDisabled()) return;
  clearTimeout(timeoutId);

  const legacy = legacyFullInterval();
  if (!legacy && !getActiveIntervalTargets().length) return;

  const wait = initialDelayMs ?? getWorkerIntervalMs();
  timeoutId = setTimeout(async () => {
    try {
      await runIntervalTickWork();
    } catch (err) {
      console.error("[oddsSync]", err);
      recordSyncResult(null, err);
    }
    scheduleNext();
  }, wait);
}

export function rescheduleOddsSyncWorker() {
  if (stopped || oddsSyncDisabled()) return;
  clearTimeout(timeoutId);
  const legacy = legacyFullInterval();
  if (legacy) {
    scheduleNext(getWorkerIntervalMs());
  } else if (getActiveIntervalTargets().length) {
    scheduleNext(getWorkerIntervalMs());
  }
}

function dedupeRaceKeys(races) {
  const seen = new Set();
  const out = [];
  for (const r of races) {
    const k = `${r.meeting_date}|${r.venue_code}|${r.race_no}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      meeting_date: String(r.meeting_date),
      venue_code: String(r.venue_code),
      race_no: Number(r.race_no),
    });
  }
  return out;
}

/**
 * Arm interval for one or more races (in-memory). Starts timer + optional immediate first run.
 * @param {{ meeting_date: string; venue_code: string; race_no: number }[]} races
 */
export async function armIntervalForRaces(races) {
  if (oddsSyncDisabled()) return { ok: false, error: "disabled" };
  if (legacyFullInterval()) {
    return { ok: false, error: "legacy_full_interval" };
  }
  const normalized = dedupeRaceKeys(races);
  if (!normalized.length) return { ok: false, error: "empty" };
  setActiveIntervalTargets(normalized);
  clearTimeout(timeoutId);
  stopped = false;

  const ranImmediate = beginSyncExclusive();
  if (ranImmediate) {
    try {
      for (const body of normalized) {
        await runOddsSyncSingleRace({
          meetingDate: body.meeting_date,
          venueCode: body.venue_code,
          raceNo: body.race_no,
        });
      }
    } catch (err) {
      console.error("[oddsSync] immediate sync", err);
      recordSyncResult(null, err);
    } finally {
      endSyncExclusive();
      clearCurrentSync();
    }
  }

  scheduleNext(getWorkerIntervalMs());
  return {
    ok: true,
    targets: normalized,
    target: normalized[0],
    immediateSkipped: ranImmediate ? false : true,
  };
}

/** @param {{ meeting_date: string; venue_code: string; race_no: number }} body */
export async function armIntervalForRace(body) {
  return armIntervalForRaces([body]);
}

/**
 * Arm interval keeping any already-armed targets (merge + dedupe).
 * @param {{ meeting_date: string; venue_code: string; race_no: number }[]} races
 */
export async function armIntervalForRacesMerged(races) {
  const merged = dedupeRaceKeys([...getActiveIntervalTargets(), ...(races ?? [])]);
  return armIntervalForRaces(merged);
}

/**
 * Remove specific races from the interval targets; disarm entirely when none remain.
 * @param {{ meeting_date: string; venue_code: string; race_no: number }[]} races
 */
export function removeIntervalTargets(races) {
  if (legacyFullInterval()) {
    return { ok: false, error: "legacy_full_interval" };
  }
  const removeKeys = new Set(
    dedupeRaceKeys(races ?? []).map((r) => `${r.meeting_date}|${r.venue_code}|${r.race_no}`)
  );
  const remaining = getActiveIntervalTargets().filter(
    (t) => !removeKeys.has(`${t.meeting_date}|${t.venue_code}|${t.race_no}`)
  );
  if (!remaining.length) return disarmInterval();
  setActiveIntervalTargets(remaining);
  return { ok: true, targets: remaining };
}

export function disarmInterval() {
  if (legacyFullInterval()) {
    return { ok: false, error: "legacy_full_interval" };
  }
  clearActiveIntervalTarget();
  clearTimeout(timeoutId);
  timeoutId = null;
  return { ok: true };
}

/**
 * @returns {() => void} stop function
 */
export function startOddsSyncWorker() {
  if (oddsSyncDisabled()) {
    console.log("[oddsSync] disabled (set ODDS_SYNC_ENABLED=false to keep off)");
    return () => {};
  }

  stopped = false;
  const legacy = legacyFullInterval();
  console.log(
    `[oddsSync] enabled, interval ${getWorkerIntervalMs()}ms, types ${process.env.ODDS_SYNC_ODDS_TYPES ?? "WIN,PLA"}` +
      (legacy ? ", mode=legacy_full_interval" : ", mode=targeted_interval")
  );

  if (legacy) {
    scheduleNext(1500);
  }

  return () => {
    stopped = true;
    clearTimeout(timeoutId);
    timeoutId = null;
  };
}

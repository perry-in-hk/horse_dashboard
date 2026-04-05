import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { fetchRaceRunnersForRace, getHorseRacingApi } from "../lib/hkjcOddsClient.js";
import {
  getActiveIntervalTarget,
  getActiveIntervalTargets,
  getCurrentSync,
  isSyncBusy,
} from "../lib/oddsWorkerRuntime.js";
import { getLastSyncResult } from "../lib/syncState.js";
import { getWorkerIntervalMs, setWorkerIntervalMs } from "../lib/realtimeSettings.js";
import {
  armIntervalForRaces,
  disarmInterval,
  rescheduleOddsSyncWorker,
  runOddsSyncAllActiveMeetings,
} from "../oddsSyncWorker.js";

function oddsSyncEnabled() {
  return process.env.ODDS_SYNC_ENABLED !== "false";
}

function legacyFullInterval() {
  return process.env.ODDS_SYNC_LEGACY_FULL_INTERVAL === "true";
}

function snapshotPurgeEnabled() {
  return process.env.ODDS_SNAPSHOT_PURGE_ENABLED === "true";
}

const router = Router();

const raceKeyQuery = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
});

const historyQuery = raceKeyQuery
  .extend({
    since: z.string().optional(),
    limit: z.coerce.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.since != null && data.since !== "" && Number.isNaN(Date.parse(data.since))) {
      ctx.addIssue({ code: "custom", path: ["since"], message: "Invalid since timestamp" });
    }
    const cap = data.since ? 5000 : 500;
    const lim = data.limit ?? 200;
    if (lim > cap) {
      ctx.addIssue({ code: "custom", path: ["limit"], message: `limit must be at most ${cap}` });
    }
  });

const meetingKeyQuery = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
});

const settingsPut = z.object({
  workerIntervalMs: z.number().int().min(5000).max(120000),
});

const raceKey = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
});

/** Single race (legacy) or `races` array for multi-race auto-sync. */
const syncIntervalBody = z.union([
  z.object({
    races: z.array(raceKey).min(1).max(24),
  }),
  raceKey,
]);

const snapshotKeyBody = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
});

const exportQuery = raceKeyQuery.extend({
  limit: z.coerce.number().int().min(1).max(50000).optional().default(50000),
});

router.get("/meetings", async (_req, res, next) => {
  try {
    const api = getHorseRacingApi();
    const meetings = await api.getActiveMeetings();
    res.json({ meetings });
  } catch (e) {
    next(e);
  }
});

/** Live racecard runners (horse name + code) for one race via HKJC GraphQL. */
router.get("/race-runners", async (req, res, next) => {
  try {
    const parsed = raceKeyQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const runners = await fetchRaceRunnersForRace(q.meeting_date, q.venue_code, q.race_no);
    if (runners == null) {
      return res.status(404).json({ error: "Meeting or race not found" });
    }
    res.json({ runners });
  } catch (e) {
    next(e);
  }
});

router.get("/settings", (_req, res) => {
  res.json({
    workerIntervalMs: getWorkerIntervalMs(),
    oddsSyncEnabled: oddsSyncEnabled(),
  });
});

router.get("/status", (_req, res) => {
  const targets = getActiveIntervalTargets();
  res.json({
    oddsSyncEnabled: oddsSyncEnabled(),
    workerIntervalMs: getWorkerIntervalMs(),
    lastSync: getLastSyncResult(),
    legacyFullInterval: legacyFullInterval(),
    activeIntervalTargets: targets,
    activeIntervalTarget: getActiveIntervalTarget(),
    currentSync: getCurrentSync(),
    syncInProgress: isSyncBusy(),
  });
});

/** One-shot: all active meetings and races (full sweep). */
router.post("/sync", async (_req, res, next) => {
  if (!oddsSyncEnabled()) {
    return res.status(400).json({ error: "Odds sync is disabled (ODDS_SYNC_ENABLED=false)" });
  }
  try {
    const result = await runOddsSyncAllActiveMeetings();
    res.json(result);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "EBUSY") {
      return res.status(409).json({ error: "Odds sync already in progress" });
    }
    next(e);
  }
});

/** Start repeating interval for one or more races (requires non-legacy worker mode). */
router.post("/sync-interval", async (req, res) => {
  if (!oddsSyncEnabled()) {
    return res.status(400).json({ error: "Odds sync is disabled (ODDS_SYNC_ENABLED=false)" });
  }
  const parsed = syncIntervalBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  }
  const races = "races" in parsed.data ? parsed.data.races : [parsed.data];
  const r = await armIntervalForRaces(races);
  if (!r.ok) {
    if (r.error === "legacy_full_interval") {
      return res.status(400).json({
        error: "Targeted interval is unavailable when ODDS_SYNC_LEGACY_FULL_INTERVAL=true",
      });
    }
    if (r.error === "empty") {
      return res.status(400).json({ error: "No races specified" });
    }
    return res.status(400).json({ error: "Odds sync is disabled" });
  }
  res.json(r);
});

router.delete("/sync-interval", (_req, res) => {
  if (!oddsSyncEnabled()) {
    return res.status(400).json({ error: "Odds sync is disabled (ODDS_SYNC_ENABLED=false)" });
  }
  const r = disarmInterval();
  if (!r.ok && r.error === "legacy_full_interval") {
    return res.status(400).json({
      error: "Targeted interval is unavailable when ODDS_SYNC_LEGACY_FULL_INTERVAL=true",
    });
  }
  res.json({ ok: true });
});

router.put("/settings", (req, res) => {
  const parsed = settingsPut.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  }
  if (!oddsSyncEnabled()) {
    return res.status(400).json({ error: "Odds sync is disabled (ODDS_SYNC_ENABLED=false)" });
  }
  setWorkerIntervalMs(parsed.data.workerIntervalMs);
  rescheduleOddsSyncWorker();
  res.json({ workerIntervalMs: getWorkerIntervalMs() });
});

router.get("/latest", async (req, res, next) => {
  try {
    const parsed = raceKeyQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const r = await pool.query(
      `SELECT id, observed_at, meeting_date, venue_code, race_no, odds_types, payload_hash, payload
       FROM hkjc_odds_snapshots
       WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
       ORDER BY observed_at DESC
       LIMIT 1`,
      [q.meeting_date, q.venue_code, q.race_no]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "No snapshot for this race yet" });
    }
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const parsed = historyQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const limit = q.limit ?? 200;
    const params = [q.meeting_date, q.venue_code, q.race_no];
    let sql = `SELECT id, observed_at, meeting_date, venue_code, race_no, odds_types, payload_hash, payload
       FROM hkjc_odds_snapshots
       WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3`;
    if (q.since) {
      sql += ` AND observed_at >= $4::timestamptz`;
      params.push(q.since);
    }
    sql += ` ORDER BY observed_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const r = await pool.query(sql, params);
    const snapshots = [...r.rows].reverse();
    res.json({ snapshots });
  } catch (e) {
    next(e);
  }
});

/** Distinct snapshot keys in DB (Database admin: purge picker). */
router.get("/snapshot-keys", async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT meeting_date::text AS meeting_date, venue_code, race_no, COUNT(*)::int AS n
       FROM hkjc_odds_snapshots
       GROUP BY meeting_date, venue_code, race_no
       ORDER BY meeting_date DESC, venue_code, race_no`
    );
    res.json({ keys: r.rows });
  } catch (e) {
    next(e);
  }
});

/** Full JSON backup for one race (cap 50k rows). Requires ODDS_SNAPSHOT_PURGE_ENABLED=true. */
router.get("/snapshots/export", async (req, res, next) => {
  if (!snapshotPurgeEnabled()) {
    return res.status(403).json({
      error: "Odds snapshot export is disabled (set ODDS_SNAPSHOT_PURGE_ENABLED=true)",
    });
  }
  try {
    const parsed = exportQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const r = await pool.query(
      `SELECT id, observed_at, meeting_date, venue_code, race_no, odds_types, payload_hash, payload
       FROM hkjc_odds_snapshots
       WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
       ORDER BY observed_at ASC
       LIMIT $4`,
      [q.meeting_date, q.venue_code, q.race_no, q.limit]
    );
    const truncated = r.rows.length >= q.limit;
    res.json({ snapshots: r.rows, truncated, limit: q.limit });
  } catch (e) {
    next(e);
  }
});

/** Delete all snapshots for one race. Requires ODDS_SNAPSHOT_PURGE_ENABLED=true. */
router.delete("/snapshots", async (req, res, next) => {
  if (!snapshotPurgeEnabled()) {
    return res.status(403).json({
      error: "Odds snapshot purge is disabled (set ODDS_SNAPSHOT_PURGE_ENABLED=true)",
    });
  }
  try {
    const parsed = snapshotKeyBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const r = await pool.query(
      `DELETE FROM hkjc_odds_snapshots
       WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3`,
      [q.meeting_date, q.venue_code, q.race_no]
    );
    res.json({ deleted: r.rowCount ?? 0 });
  } catch (e) {
    next(e);
  }
});

/** Snapshot row counts per race_no for a meeting (helps pick a race that has data). */
router.get("/snapshot-counts", async (req, res, next) => {
  try {
    const parsed = meetingKeyQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
    }
    const q = parsed.data;
    const r = await pool.query(
      `SELECT race_no, COUNT(*)::int AS n
       FROM hkjc_odds_snapshots
       WHERE meeting_date = $1::date AND venue_code = $2
       GROUP BY race_no
       ORDER BY race_no`,
      [q.meeting_date, q.venue_code]
    );
    res.json({ counts: r.rows });
  } catch (e) {
    next(e);
  }
});

export default router;

import { Router } from "express";
import { z } from "zod";
import { buildCouncilExportMarkdown } from "../lib/councilExport.js";
import { pool } from "../db.js";
import {
  appendUserMessage,
  getCouncilStatus,
  getMessages,
  getRoundGapBounds,
  hydrateRoundGapFromRedis,
  getSessionHistory,
  runCouncilRoundForRace,
  setDateActivated,
  setRoundMinGapMs,
  startCouncilSession,
  stopCouncilSession,
} from "../lib/councilService.js";

const router = Router();

const raceKey = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
});

const messageBody = raceKey.extend({
  content: z.string().min(1).max(6000),
});

router.get("/ping", async (_req, res) => {
  res.json({
    ok: true,
    route: "council",
    features: ["sessions", "status", "messages", "ws", "chatroom"],
    now_utc: new Date().toISOString(),
  });
});

router.get("/status", async (req, res) => {
  const parsed = raceKey.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
  const q = parsed.data;
  const status = await getCouncilStatus({
    meetingDate: q.meeting_date,
    venueCode: q.venue_code,
    raceNo: q.race_no,
  });
  res.json(status);
});

const activateDateBody = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  enabled: z.boolean(),
});

router.post("/activate-date", async (req, res) => {
  const parsed = activateDateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  const activated = await setDateActivated(parsed.data.meeting_date, parsed.data.enabled, req.user?.id ?? null);
  res.json({ ok: true, meeting_date: parsed.data.meeting_date, activated });
});

const roundGapBody = z.object({
  gap_seconds: z.coerce.number().int().min(15).max(600),
});

router.get("/round-gap", async (_req, res) => {
  const ms = await hydrateRoundGapFromRedis();
  res.json({
    ok: true,
    round_min_gap_ms: ms,
    round_min_gap_seconds: Math.round(ms / 1000),
    round_gap_bounds: getRoundGapBounds(),
  });
});

router.post("/round-gap", async (req, res) => {
  const parsed = roundGapBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  try {
    const ms = await setRoundMinGapMs(parsed.data.gap_seconds * 1000, req.user?.id ?? null);
    res.json({
      ok: true,
      round_min_gap_ms: ms,
      round_min_gap_seconds: Math.round(ms / 1000),
      round_gap_bounds: getRoundGapBounds(),
    });
  } catch (e) {
    const status = Number(e?.status) || 500;
    return res.status(status).json({ error: e?.message ?? "Update failed" });
  }
});

router.post("/start", async (req, res) => {
  const parsed = raceKey.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  const b = parsed.data;
  let session;
  try {
    session = await startCouncilSession({
      meetingDate: b.meeting_date,
      venueCode: b.venue_code,
      raceNo: b.race_no,
      trigger: "manual",
      userId: req.user?.id ?? null,
    });
  } catch (e) {
    const status = Number(e?.status) || 500;
    return res.status(status).json({ error: e?.message ?? "Start failed" });
  }
  runCouncilRoundForRace({
    meetingDate: b.meeting_date,
    venueCode: b.venue_code,
    raceNo: b.race_no,
    force: true,
    trigger: "http_start",
  }).catch((e) => console.error("[council/start round]", e));
  res.json({
    ok: true,
    session_id: session.session_id,
  });
});

router.post("/stop", async (req, res) => {
  const parsed = raceKey.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  const b = parsed.data;
  const ok = await stopCouncilSession({
    meetingDate: b.meeting_date,
    venueCode: b.venue_code,
    raceNo: b.race_no,
  });
  res.json({ ok });
});

router.post("/message", async (req, res) => {
  const parsed = messageBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  const b = parsed.data;
  const msg = await appendUserMessage({
    meetingDate: b.meeting_date,
    venueCode: b.venue_code,
    raceNo: b.race_no,
    userId: req.user?.id ?? null,
    username: req.user?.username ?? "user",
    content: b.content,
  });
  runCouncilRoundForRace({
    meetingDate: b.meeting_date,
    venueCode: b.venue_code,
    raceNo: b.race_no,
    force: true,
    trigger: "http_message",
  }).catch((e) => console.error("[council/message round]", e));
  res.json({ ok: true, message: msg });
});

router.get("/messages", async (req, res) => {
  const parsed = raceKey
    .extend({
      session_id: z.coerce.number().int().positive().optional(),
      after_seq: z.coerce.number().int().min(0).optional().default(0),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
  const q = parsed.data;
  const rows = await getMessages({
    meetingDate: q.meeting_date,
    venueCode: q.venue_code,
    raceNo: q.race_no,
    sessionId: q.session_id ?? null,
    afterSeq: q.after_seq,
  });
  res.json({ items: rows });
});

router.get("/sessions", async (req, res) => {
  const parsed = raceKey
    .extend({
      limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
  const q = parsed.data;
  const items = await getSessionHistory({
    meetingDate: q.meeting_date,
    venueCode: q.venue_code,
    raceNo: q.race_no,
    limit: q.limit,
  });
  res.json({ items });
});

router.get("/meeting-history", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
       meeting_date::text AS meeting_date,
       venue_code,
       ARRAY_AGG(DISTINCT race_no ORDER BY race_no) AS race_numbers,
       MAX(started_at_utc) AS latest_started_at_utc
     FROM hkjc_council_sessions
     GROUP BY meeting_date, venue_code
     ORDER BY meeting_date DESC, latest_started_at_utc DESC
     LIMIT 300`
  );
  const items = rows.map((r) => ({
    date: r.meeting_date,
    venueCode: r.venue_code,
    races: (Array.isArray(r.race_numbers) ? r.race_numbers : []).map((no) => ({
      no: String(no),
      status: "HISTORICAL",
    })),
    source: "history",
  }));
  res.json({ items });
});

router.get("/export", async (req, res) => {
  const parsed = raceKey
    .extend({
      session_id: z.coerce.number().int().positive().optional(),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Bad query", details: parsed.error.flatten() });
  const q = parsed.data;
  try {
    const { markdown, filename } = await buildCouncilExportMarkdown({
      meetingDate: q.meeting_date,
      venueCode: q.venue_code,
      raceNo: q.race_no,
      sessionId: q.session_id ?? null,
    });
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(markdown);
  } catch (e) {
    console.error("[council/export]", e);
    res.status(500).json({ error: e?.message ?? "Export failed" });
  }
});

export default router;


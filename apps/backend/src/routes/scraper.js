import { spawn } from "child_process";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";
import {
  defaultWedSunIsoHk,
  normalizeHistoricalIsoDates,
} from "../lib/scraperDates.js";
import { normalizeHorseCodes } from "../lib/horseCodes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRAPER_ROOT = path.join(__dirname, "../../../../services/scraper");

const SCRIPTS = {
  historical: "src/historical.js",
  "horse-details": "src/horseDetails.js",
};

const MAX_LOG_LINES = 400;

/** @type {Map<string, { pid: number; startedAt: string; logs: string[]; child: import('child_process').ChildProcess }>} */
const active = new Map();

/** @type {Map<string, { exitCode: number | null; endedAt: string; logs: string[] }>} */
const lastRun = new Map();

function scraperRoot() {
  return process.env.SCRAPER_ROOT ?? DEFAULT_SCRAPER_ROOT;
}

function appendLine(mapKey, line) {
  const entry = active.get(mapKey);
  if (!entry) return;
  entry.logs.push(line);
  if (entry.logs.length > MAX_LOG_LINES) entry.logs.splice(0, entry.logs.length - MAX_LOG_LINES);
}

function runScript(key, extraEnv = {}) {
  const rel = SCRIPTS[key];
  const root = scraperRoot();
  const scriptPath = path.join(root, rel);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Scraper script not found: ${scriptPath} (set SCRAPER_ROOT?)`);
  }

  const child = spawn(process.execPath, [scriptPath], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });

  const startedAt = new Date().toISOString();
  const logs = [];
  active.set(key, { pid: child.pid ?? 0, startedAt, logs, child });

  const push = (buf, stream) => {
    const s = buf.toString();
    for (const line of s.split(/\r?\n/)) {
      if (line === "") continue;
      const full = `[${stream}] ${line}`;
      appendLine(key, full);
    }
  };

  child.stdout?.on("data", (d) => push(d, "out"));
  child.stderr?.on("data", (d) => push(d, "err"));

  child.on("close", (code) => {
    const endedAt = new Date().toISOString();
    const snap = active.get(key);
    const logCopy = snap ? [...snap.logs] : [];
    lastRun.set(key, { exitCode: code, endedAt, logs: logCopy });
    active.delete(key);
  });

  child.on("error", (err) => {
    appendLine(key, `[error] ${err.message}`);
  });
}

/** @param {string[]} isoDates YYYY-MM-DD */
async function findConflictingRaceDates(isoDates) {
  if (isoDates.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT race_date::text AS d
     FROM (
       SELECT race_date FROM hkjc_race_results WHERE race_date = ANY($1::date[])
       UNION
       SELECT race_date FROM hkjc_dividends WHERE race_date = ANY($1::date[])
       UNION
       SELECT race_date FROM hkjc_local_race_events WHERE race_date = ANY($1::date[])
     ) x
     ORDER BY d`,
    [isoDates]
  );
  return rows.map((r) => r.d);
}

const router = express.Router();

router.get("/status", (_req, res) => {
  const root = scraperRoot();
  const payload = {};
  for (const key of Object.keys(SCRIPTS)) {
    const running = active.get(key);
    const last = lastRun.get(key);
    payload[key] = {
      script: SCRIPTS[key],
      scraperRoot: root,
      running: running
        ? { pid: running.pid, startedAt: running.startedAt, logTail: running.logs.slice(-80) }
        : null,
      lastRun: last
        ? { exitCode: last.exitCode, endedAt: last.endedAt, logTail: last.logs.slice(-80) }
        : null,
    };
  }
  res.json(payload);
});

router.post("/run", express.json(), async (req, res) => {
  const key = req.body?.script;
  if (key !== "historical" && key !== "horse-details") {
    return res.status(400).json({
      error:
        'Body must be JSON: { "script": "historical" | "horse-details", "dates"?: string[], "horseCodes"?: string[] }',
    });
  }
  if (active.has(key)) {
    return res.status(409).json({ error: `Already running: ${key}` });
  }

  let extraEnv = {};
  if (key === "historical") {
    const isoDates = normalizeHistoricalIsoDates(req.body?.dates);
    const resolved = isoDates.length ? isoDates : defaultWedSunIsoHk();
    try {
      const conflicting = await findConflictingRaceDates(resolved);
      if (conflicting.length) {
        return res.status(409).json({
          error:
            "Data already exists for one or more race dates. Remove rows or pick other dates.",
          conflictingDates: conflicting,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ error: msg });
    }
    extraEnv = {
      SCRAPER_DATES: resolved.join(","),
      SCRAPER_STRICT_NO_DUPLICATE: "true",
      SCRAPER_USE_LEGACY_TARGET_LIST: "false",
    };
  } else if (key === "horse-details") {
    const horseCodes = normalizeHorseCodes(req.body?.horseCodes);
    if (horseCodes.length > 0) {
      extraEnv = { SCRAPER_HORSE_CODES: horseCodes.join(",") };
    } else {
      // Clear any inherited list; force DB distinct codes (override .env file source).
      extraEnv = { SCRAPER_HORSE_CODES: "", SCRAPER_HORSE_CODES_SOURCE: "db" };
    }
  }

  try {
    runScript(key, extraEnv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }

  const run = active.get(key);
  return res.status(202).json({
    ok: true,
    script: key,
    pid: run?.pid,
    startedAt: run?.startedAt,
    message: "Scraper started in the background. Poll GET /api/scraper/status for progress.",
  });
});

export default router;

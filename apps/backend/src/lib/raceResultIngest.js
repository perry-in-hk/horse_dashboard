import { pool } from "../db.js";
import { fetchMeetingWithRunners } from "./hkjcOddsClient.js";
import { parseDividends, parseRaceResults } from "./hkjcLocalResultsParse.js";
import { getRedisClient } from "./redisClient.js";
import { isEndedRaceStatus } from "./timeHkt.js";

const HKJC_BASE = "https://racing.hkjc.com";
const REDIS_DONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REDIS_RETRY_TTL_MS = 45_000;
const REDIS_LOCK_TTL_MS = 90_000;
const FETCH_TIMEOUT_MS = 30_000;
const MIN_HTML_LEN = 200;

const memoryFlags = new Map();

function raceKey(meetingDate, venueCode, raceNo) {
  return `${meetingDate}:${String(venueCode).toUpperCase()}:${raceNo}`;
}

function redisDoneKey(k) {
  return `race_results:done:${k}`;
}

function redisRetryKey(k) {
  return `race_results:retry:${k}`;
}

function redisLockKey(k) {
  return `race_results:lock:${k}`;
}

function localResultsUrl(meetingDate, venueCode, raceNo) {
  // meetingDate is YYYY-MM-DD → racedate=YYYY/MM/DD
  const racedate = String(meetingDate).replace(/-/g, "/");
  const course = String(venueCode).toUpperCase();
  return `${HKJC_BASE}/zh-hk/local/information/localresults?racedate=${racedate}&Racecourse=${course}&RaceNo=${raceNo}`;
}

function statusUnavailable(status) {
  const s = String(status ?? "").toUpperCase();
  return ["CANCELLED", "ABANDONED", "VOID"].some((k) => s.includes(k));
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  if (!html || html.length < MIN_HTML_LEN) throw new Error("Empty or short HTML");
  return html;
}

async function upsertRaceResult(raceDate, racecourse, raceNo, row) {
  await pool.query(
    `INSERT INTO hkjc_race_results
       (race_date, racecourse, race_no, source_type,
        horse_no, horse_name, horse_code, jockey, trainer,
        actual_weight, declared_weight, finish_position,
        draw, margin, running_positions, finish_time, win_odds)
     VALUES ($1,$2,$3,'local',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (race_date, racecourse, race_no, horse_no)
     DO UPDATE SET
       horse_name = EXCLUDED.horse_name,
       horse_code = EXCLUDED.horse_code,
       jockey = EXCLUDED.jockey,
       trainer = EXCLUDED.trainer,
       actual_weight = EXCLUDED.actual_weight,
       declared_weight = EXCLUDED.declared_weight,
       finish_position = EXCLUDED.finish_position,
       draw = EXCLUDED.draw,
       margin = EXCLUDED.margin,
       running_positions = EXCLUDED.running_positions,
       finish_time = EXCLUDED.finish_time,
       win_odds = EXCLUDED.win_odds`,
    [
      raceDate,
      racecourse,
      raceNo,
      row.horse_no,
      row.horse_name,
      row.horse_code,
      row.jockey,
      row.trainer,
      row.actual_weight,
      row.declared_weight,
      row.finish_position,
      row.draw,
      row.margin,
      row.running_positions,
      row.finish_time,
      row.win_odds,
    ]
  );
}

async function upsertDividend(raceDate, racecourse, raceNo, row) {
  await pool.query(
    `INSERT INTO hkjc_dividends
       (race_date, racecourse, race_no, source_type, pool, combination, payout_hkd)
     VALUES ($1,$2,$3,'local',$4,$5,$6)
     ON CONFLICT (race_date, racecourse, race_no, pool, combination)
     DO UPDATE SET payout_hkd = EXCLUDED.payout_hkd`,
    [raceDate, racecourse, raceNo, row.pool, row.combination, row.payout_hkd]
  );
}

async function countStored(meetingDate, venueCode, raceNo) {
  const course = String(venueCode).toUpperCase();
  const [results, dividends] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n FROM hkjc_race_results
       WHERE race_date = $1::date AND racecourse = $2 AND race_no = $3`,
      [meetingDate, course, raceNo]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM hkjc_dividends
       WHERE race_date = $1::date AND racecourse = $2 AND race_no = $3`,
      [meetingDate, course, raceNo]
    ),
  ]);
  return {
    resultCount: Number(results.rows[0]?.n ?? 0),
    dividendCount: Number(dividends.rows[0]?.n ?? 0),
  };
}

/**
 * Optional GraphQL placings when localresults page is not ready yet.
 */
async function upsertFromGraphQLFinalPositions(meetingDate, venueCode, raceNo) {
  let meeting;
  try {
    meeting = await fetchMeetingWithRunners(meetingDate, venueCode);
  } catch (err) {
    console.warn("[raceResultIngest] GraphQL fallback failed:", err?.message ?? err);
    return 0;
  }
  const race = meeting?.races?.find((r) => parseInt(String(r.no), 10) === raceNo);
  if (!race?.runners?.length) return 0;

  let written = 0;
  const course = String(venueCode).toUpperCase();
  for (const ru of race.runners) {
    const horseNo = parseInt(String(ru?.no ?? "").trim(), 10);
    if (!Number.isFinite(horseNo) || horseNo <= 0) continue;
    const pos = ru?.finalPosition;
    if (pos == null || pos === "" || Number(pos) <= 0) continue;
    const code = String(ru?.horse?.code ?? "").trim().toUpperCase() || null;
    const name =
      String(ru?.name_ch ?? ru?.name_en ?? "")
        .trim()
        .replace(/\s+/g, " ") || null;
    await upsertRaceResult(meetingDate, course, raceNo, {
      horse_no: horseNo,
      horse_name: name,
      horse_code: code,
      jockey: null,
      trainer: null,
      actual_weight: null,
      declared_weight: null,
      finish_position: String(pos),
      draw: ru?.draw != null ? parseInt(String(ru.draw), 10) || null : null,
      margin: null,
      running_positions: null,
      finish_time: null,
      win_odds: ru?.winOdds != null ? Number(ru.winOdds) || null : null,
    });
    written += 1;
  }
  return written;
}

async function markDone(k) {
  memoryFlags.set(k, { state: "done", at: Date.now() });
  const redis = await getRedisClient().catch(() => null);
  if (redis) {
    await redis.set(redisDoneKey(k), "1", { PX: REDIS_DONE_TTL_MS }).catch(() => {});
    await redis.del(redisRetryKey(k)).catch(() => {});
  }
}

async function markRetry(k) {
  memoryFlags.set(k, { state: "retry", at: Date.now() });
  const redis = await getRedisClient().catch(() => null);
  if (redis) {
    await redis.set(redisRetryKey(k), "1", { PX: REDIS_RETRY_TTL_MS }).catch(() => {});
  }
}

async function markUnavailable(k) {
  memoryFlags.set(k, { state: "unavailable", at: Date.now() });
  const redis = await getRedisClient().catch(() => null);
  if (redis) {
    await redis.set(redisDoneKey(k), "unavailable", { PX: REDIS_DONE_TTL_MS }).catch(() => {});
  }
}

async function shouldSkip(k) {
  const mem = memoryFlags.get(k);
  if (mem?.state === "done" || mem?.state === "unavailable") return true;
  if (mem?.state === "retry" && Date.now() - mem.at < REDIS_RETRY_TTL_MS) return true;

  const redis = await getRedisClient().catch(() => null);
  if (!redis) return false;
  const done = await redis.get(redisDoneKey(k)).catch(() => null);
  if (done) {
    memoryFlags.set(k, { state: done === "unavailable" ? "unavailable" : "done", at: Date.now() });
    return true;
  }
  const retry = await redis.get(redisRetryKey(k)).catch(() => null);
  if (retry) {
    memoryFlags.set(k, { state: "retry", at: Date.now() });
    return true;
  }
  return false;
}

async function tryLock(k) {
  const redis = await getRedisClient().catch(() => null);
  if (!redis) {
    const mem = memoryFlags.get(k);
    if (mem?.state === "locking") return false;
    memoryFlags.set(k, { state: "locking", at: Date.now() });
    return true;
  }
  const ok = await redis.set(redisLockKey(k), "1", { NX: true, PX: REDIS_LOCK_TTL_MS }).catch(() => null);
  return ok === "OK" || ok === true;
}

async function releaseLock(k) {
  const mem = memoryFlags.get(k);
  if (mem?.state === "locking") memoryFlags.delete(k);
  const redis = await getRedisClient().catch(() => null);
  if (redis) await redis.del(redisLockKey(k)).catch(() => {});
}

async function clearDedupeFlags(k) {
  memoryFlags.delete(k);
  const redis = await getRedisClient().catch(() => null);
  if (redis) {
    await redis.del(redisDoneKey(k)).catch(() => {});
    await redis.del(redisRetryKey(k)).catch(() => {});
  }
}

/**
 * Fetch HKJC local results for one race and upsert placings + dividends.
 * Safe to call repeatedly; uses Redis/memory dedupe + short retry backoff.
 * Pass `force: true` to bypass dedupe and re-fetch from HKJC (manual UI refresh).
 *
 * @returns {Promise<{ ok: boolean, status: string, resultCount?: number, dividendCount?: number, reason?: string }>}
 */
export async function ingestRaceResults({ meetingDate, venueCode, raceNo, raceStatus = null, force = false }) {
  const date = String(meetingDate ?? "").trim();
  const venue = String(venueCode ?? "").trim().toUpperCase();
  const no = parseInt(String(raceNo), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !venue || !Number.isFinite(no) || no <= 0) {
    return { ok: false, status: "invalid", reason: "bad_key" };
  }

  const k = raceKey(date, venue, no);

  if (statusUnavailable(raceStatus)) {
    await markUnavailable(k);
    return { ok: true, status: "unavailable", reason: "cancelled_or_void" };
  }

  if (force) {
    await clearDedupeFlags(k);
  }

  if (!force && (await shouldSkip(k))) {
    const counts = await countStored(date, venue, no);
    if (counts.resultCount > 0 && counts.dividendCount > 0) {
      return { ok: true, status: "ready", ...counts };
    }
    const mem = memoryFlags.get(k);
    if (mem?.state === "unavailable") return { ok: true, status: "unavailable" };
    return { ok: true, status: "pending", ...counts };
  }

  const locked = await tryLock(k);
  if (!locked) return { ok: true, status: "pending", reason: "locked" };

  try {
    const existing = await countStored(date, venue, no);
    if (!force && existing.resultCount > 0 && existing.dividendCount > 0) {
      await markDone(k);
      return { ok: true, status: "ready", ...existing };
    }

    let resultCount = 0;
    let dividendCount = 0;
    let source = null;

    try {
      const url = localResultsUrl(date, venue, no);
      const html = await fetchHtml(url);
      const results = parseRaceResults(html);
      const dividends = parseDividends(html);

      for (const row of results) {
        if (row.horse_no == null) continue;
        await upsertRaceResult(date, venue, no, row);
        resultCount += 1;
      }
      for (const row of dividends) {
        if (!row.combination) continue;
        await upsertDividend(date, venue, no, row);
        dividendCount += 1;
      }
      source = "localresults";
    } catch (err) {
      console.warn(`[raceResultIngest] localresults fetch failed ${k}:`, err?.message ?? err);
    }

    if (resultCount === 0) {
      const gqlCount = await upsertFromGraphQLFinalPositions(date, venue, no);
      if (gqlCount > 0) {
        resultCount = gqlCount;
        source = source ? `${source}+graphql` : "graphql";
      }
    }

    const stored = await countStored(date, venue, no);
    if (stored.resultCount > 0 && stored.dividendCount > 0) {
      await markDone(k);
      return { ok: true, status: "ready", source, ...stored };
    }
    if (stored.resultCount > 0) {
      // Placings only — keep retrying for dividends
      await markRetry(k);
      return { ok: true, status: "pending", source, ...stored, reason: "awaiting_dividends" };
    }

    await markRetry(k);
    return { ok: true, status: "pending", source, ...stored, reason: "awaiting_page" };
  } catch (err) {
    console.warn(`[raceResultIngest] ingest error ${k}:`, err?.message ?? err);
    await markRetry(k);
    return { ok: false, status: "pending", reason: err?.message ?? "error" };
  } finally {
    await releaseLock(k);
  }
}

/**
 * Read stored placings + dividends for UI / export.
 */
export async function getRaceResultsPayload({ meetingDate, venueCode, raceNo }) {
  const date = String(meetingDate ?? "").trim();
  const venue = String(venueCode ?? "").trim().toUpperCase();
  const no = parseInt(String(raceNo), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !venue || !Number.isFinite(no) || no <= 0) {
    return { status: "unavailable", placings: [], dividends: [], fetched_at: null };
  }

  const k = raceKey(date, venue, no);
  const mem = memoryFlags.get(k);
  if (mem?.state === "unavailable") {
    return { status: "unavailable", placings: [], dividends: [], fetched_at: null };
  }

  const [placingRows, dividendRows] = await Promise.all([
    pool.query(
      `SELECT horse_no, horse_name, horse_code, finish_position, jockey, trainer,
              draw, margin, finish_time, win_odds, created_at
       FROM hkjc_race_results
       WHERE race_date = $1::date AND racecourse = $2 AND race_no = $3
       ORDER BY
         CASE WHEN finish_position ~ '^[0-9]+$' THEN finish_position::int ELSE 999 END ASC,
         horse_no ASC NULLS LAST`,
      [date, venue, no]
    ),
    pool.query(
      `SELECT pool, combination, payout_hkd, created_at
       FROM hkjc_dividends
       WHERE race_date = $1::date AND racecourse = $2 AND race_no = $3
       ORDER BY id ASC`,
      [date, venue, no]
    ),
  ]);

  const placings = placingRows.rows.map((r) => ({
    horse_no: r.horse_no,
    horse_name: r.horse_name,
    horse_code: r.horse_code,
    finish_position: r.finish_position,
    jockey: r.jockey,
    trainer: r.trainer,
    draw: r.draw,
    margin: r.margin,
    finish_time: r.finish_time,
    win_odds: r.win_odds != null ? Number(r.win_odds) : null,
  }));
  const dividends = dividendRows.rows.map((r) => ({
    pool: r.pool,
    combination: r.combination,
    payout_hkd: r.payout_hkd != null ? Number(r.payout_hkd) : null,
  }));

  let fetchedAt = null;
  for (const r of placingRows.rows) {
    if (r.created_at && (!fetchedAt || r.created_at > fetchedAt)) fetchedAt = r.created_at;
  }
  for (const r of dividendRows.rows) {
    if (r.created_at && (!fetchedAt || r.created_at > fetchedAt)) fetchedAt = r.created_at;
  }

  let status = "pending";
  if (placings.length > 0 && dividends.length > 0) status = "ready";
  else if (placings.length > 0) status = "pending";

  const redis = await getRedisClient().catch(() => null);
  if (redis) {
    const done = await redis.get(redisDoneKey(k)).catch(() => null);
    if (done === "unavailable") status = "unavailable";
  }

  return {
    meeting_date: date,
    venue_code: venue,
    race_no: no,
    status,
    placings,
    dividends,
    fetched_at: fetchedAt ? new Date(fetchedAt).toISOString() : null,
  };
}

export function shouldIngestForStatus(status) {
  if (!isEndedRaceStatus(status)) return false;
  if (statusUnavailable(status)) return false;
  return true;
}

export { statusUnavailable };

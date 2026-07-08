import { EventEmitter } from "node:events";
import { pool } from "../db.js";
import { getRedisClient } from "./redisClient.js";
import { buildRaceContext } from "./ai/buildRaceContext.js";
import { buildOddsMomentumPromptBlock } from "./ai/oddsMomentum.js";
import { runCouncilChatroomRound, runCouncilRound } from "./ai/council/orchestrator.js";
import { fetchMeetingWithRunners, fetchRaceRunnersForRace } from "./hkjcOddsClient.js";
import { armIntervalForRacesMerged, removeIntervalTargets } from "../oddsSyncWorker.js";
import { getActiveIntervalTargets } from "./oddsWorkerRuntime.js";
import { formatHktDate, formatHktDateTime, isEndedRaceStatus, msUntilHktMidnight, parseHktDateTime, toUtcIso } from "./timeHkt.js";

const events = new EventEmitter();
events.setMaxListeners(200);

const activeSessions = new Map();
const activatedDateMem = new Set();
const dateKey = (meetingDate) => `council:activated:${meetingDate}`;
const COUNCIL_MODE = String(process.env.COUNCIL_MODE ?? "chatroom").trim().toLowerCase();
const PRE_START_CLOSE_MS = Number(process.env.COUNCIL_CLOSE_BEFORE_START_MS ?? 60 * 1000);
const ROUND_GAP_DEFAULT_MS = Number(
  process.env.COUNCIL_ROUND_MIN_GAP_MS ?? process.env.COUNCIL_ROUND_INTERVAL_MS ?? 30 * 1000
);
const ROUND_GAP_MIN_MS = 15_000;
const ROUND_GAP_MAX_MS = 600_000;
const roundGapKey = "council:round_gap_ms";
/** @type {number | null} */
let roundGapMsMem = null;

export function getRoundMinGapMsSync() {
  return Number(roundGapMsMem ?? ROUND_GAP_DEFAULT_MS);
}

export async function hydrateRoundGapFromRedis() {
  const redis = await getRedisClient().catch(() => null);
  if (!redis) return getRoundMinGapMsSync();
  const v = await redis.get(roundGapKey).catch(() => null);
  if (v != null) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= ROUND_GAP_MIN_MS && n <= ROUND_GAP_MAX_MS) {
      roundGapMsMem = Math.round(n);
    }
  }
  return getRoundMinGapMsSync();
}

export async function getRoundMinGapMs() {
  if (roundGapMsMem != null) return roundGapMsMem;
  return hydrateRoundGapFromRedis();
}

export function getRoundGapBounds() {
  return {
    min_ms: ROUND_GAP_MIN_MS,
    max_ms: ROUND_GAP_MAX_MS,
    min_seconds: ROUND_GAP_MIN_MS / 1000,
    max_seconds: ROUND_GAP_MAX_MS / 1000,
    default_ms: ROUND_GAP_DEFAULT_MS,
  };
}

/** Persisted round cadence (seconds between council rounds). */
export async function setRoundMinGapMs(ms, userId = null) {
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n) || n < ROUND_GAP_MIN_MS || n > ROUND_GAP_MAX_MS) {
    const err = new Error(
      `Round gap must be between ${ROUND_GAP_MIN_MS / 1000}s and ${ROUND_GAP_MAX_MS / 1000}s`
    );
    err.status = 400;
    throw err;
  }
  roundGapMsMem = n;
  const redis = await getRedisClient().catch(() => null);
  if (redis) await redis.set(roundGapKey, String(n)).catch(() => {});
  emit("round_gap_update", {
    round_min_gap_ms: n,
    round_min_gap_seconds: Math.round(n / 1000),
    updated_by_user_id: userId,
    updated_at_hkt: formatHktDateTime(),
  });
  for (const s of getAllActiveSessions()) {
    emitCadenceUpdate(s);
  }
  return n;
}

function emitCadenceUpdate(state) {
  if (!state) return;
  emit("cadence_update", {
    meeting_date: state.meeting_date,
    venue_code: state.venue_code,
    race_no: state.race_no,
    session_id: state.session_id,
    running_round: Boolean(state.runningRound),
    round_no: Number(state.round_no ?? 0),
    finalized: Boolean(state.finalized),
    last_round_completed_at_ms: Number(state.last_round_completed_at ?? 0),
    round_min_gap_ms: getRoundMinGapMsSync(),
  });
}

function raceKey(meetingDate, venueCode, raceNo) {
  return `${meetingDate}:${venueCode}:${raceNo}`;
}

/** pg returns `date` columns as JS Date objects; String(date).slice(0,10) would
 * yield "Wed Jul 08" and the scheduler would kill the session as invalid. */
function toYmdDate(v) {
  if (v instanceof Date) return formatHktDate(v);
  const s = String(v ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const parsed = new Date(s);
  return Number.isFinite(parsed.getTime()) ? formatHktDate(parsed) : s.slice(0, 10);
}

function makeSessionStateFromRow(row) {
  const ymd = toYmdDate(row.meeting_date);
  return {
    key: raceKey(ymd, String(row.venue_code), Number(row.race_no)),
    session_id: Number(row.id),
    meeting_date: ymd,
    venue_code: String(row.venue_code),
    race_no: Number(row.race_no),
    runningRound: false,
    stopped: false,
    mode: COUNCIL_MODE === "stage" ? "stage" : "chatroom",
    round_no: 0,
    next_sequence: ["quant", "historian", "trend", "scout"],
    race_started_at_utc: null,
    finalized: false,
    last_user_seq: null,
    stable_rounds: 0,
    last_consensus_key: null,
    skipped_last_round: false,
    chair_ruling: null,
    chair_directives: null,
    last_confidence: null,
    last_round_completed_at: 0,
  };
}

function parseMentions(content = "") {
  const matches = String(content)
    .toLowerCase()
    .match(/@(quant|historian|trend|scout|bookie|kelly)\b/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

export function isRaceStartedStatus(status) {
  const s = String(status ?? "").toUpperCase();
  if (!s) return false;
  return ["RUNNING", "START", "IN_RUNNING", "OFF", "開跑"].some((k) => s.includes(k)) && !isEndedRaceStatus(s);
}

async function fetchRaceRuntimeInfo(meetingDate, venueCode, raceNo) {
  try {
    const meeting = await fetchMeetingWithRunners(meetingDate, venueCode);
    const race = meeting?.races?.find((r) => parseInt(String(r.no), 10) === Number(raceNo)) ?? null;
    if (!race) return { race: null, started_at_utc: null, ended: false };
    const ended = isEndedRaceStatus(race?.status);
    const startedByStatus = isRaceStartedStatus(race?.status);
    const startedByPostTime = parseHktDateTime(meetingDate, race?.postTime);
    let startedAt = null;
    if (startedByStatus && startedByPostTime) startedAt = startedByPostTime.toISOString();
    if (startedByStatus && !startedAt) startedAt = toUtcIso();
    if (!startedAt && startedByPostTime && Date.now() >= startedByPostTime.getTime()) {
      startedAt = startedByPostTime.toISOString();
    }
    return { race, started_at_utc: startedAt, ended };
  } catch {
    return { race: null, started_at_utc: null, ended: false };
  }
}

async function markDateActivated(meetingDate, userId = null) {
  activatedDateMem.add(meetingDate);
  const redis = await getRedisClient().catch(() => null);
  const ttlMs = msUntilHktMidnight(new Date());
  if (redis) {
    await redis.set(dateKey(meetingDate), String(userId ?? "1"), { PX: ttlMs });
  }
  return ttlMs;
}

/** Explicit day-level auto-start toggle. When on, the scheduler auto-starts a
 * council for every race of that day shortly before its post time. */
export async function setDateActivated(meetingDate, enabled, userId = null) {
  if (enabled) {
    await markDateActivated(meetingDate, userId);
  } else {
    activatedDateMem.delete(meetingDate);
    const redis = await getRedisClient().catch(() => null);
    if (redis) await redis.del(dateKey(meetingDate)).catch(() => {});
  }
  emit("date_activation", {
    meeting_date: meetingDate,
    activated: Boolean(enabled),
    activated_by_user_id: userId,
    activated_at_hkt: formatHktDateTime(),
  });
  return Boolean(enabled);
}

export async function isDateActivated(meetingDate) {
  if (!meetingDate) return false;
  if (activatedDateMem.has(meetingDate)) return true;
  const redis = await getRedisClient().catch(() => null);
  if (!redis) return false;
  const v = await redis.get(dateKey(meetingDate));
  if (v == null) return false;
  activatedDateMem.add(meetingDate);
  return true;
}

export async function hydrateActiveSessionsFromDb(limit = 200) {
  const { rows } = await pool.query(
    `SELECT id, meeting_date, venue_code, race_no
     FROM hkjc_council_sessions
     WHERE status = 'running' AND stopped_at_utc IS NULL
     ORDER BY id DESC
     LIMIT $1`,
    [limit]
  );
  for (const row of rows) {
    const state = makeSessionStateFromRow(row);
    if (!activeSessions.has(state.key)) activeSessions.set(state.key, state);
  }
  await ensureOddsSyncForActiveSessions();
  return activeSessions.size;
}

/** Council sessions persist in Postgres; odds-sync targets are in-memory only.
 *  Re-arm any running council race that is not already in the worker targets. */
export async function ensureOddsSyncForActiveSessions() {
  const sessions = getAllActiveSessions().filter((s) => !s.stopped && !s.finalized);
  if (!sessions.length) return { ok: true, alreadyArmed: true };

  const armedKeys = new Set(
    getActiveIntervalTargets().map((t) => `${t.meeting_date}|${t.venue_code}|${t.race_no}`)
  );
  const missing = sessions.filter((s) => {
    const k = `${s.meeting_date}|${s.venue_code}|${s.race_no}`;
    return !armedKeys.has(k);
  });
  if (!missing.length) return { ok: true, alreadyArmed: true };

  try {
    const result = await armIntervalForRacesMerged(
      missing.map((s) => ({
        meeting_date: s.meeting_date,
        venue_code: s.venue_code,
        race_no: s.race_no,
      }))
    );
    if (!result?.ok && result?.error !== "legacy_full_interval") {
      console.warn("[council] ensureOddsSyncForActiveSessions:", result?.error ?? "unknown");
    }
    return result;
  } catch (err) {
    console.error("[council] ensureOddsSyncForActiveSessions failed", err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

async function nextSeq(sessionId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(seq), 0)::int + 1 AS n
     FROM hkjc_council_messages
     WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0]?.n ?? 1;
}

async function nextPicksVersion(sessionId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(version), 0)::int + 1 AS n
     FROM hkjc_council_picks
     WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0]?.n ?? 1;
}

async function insertMessage(sessionId, role, content, meta = {}, picksVersion = null) {
  const seq = await nextSeq(sessionId);
  const { rows } = await pool.query(
    `INSERT INTO hkjc_council_messages (session_id, seq, role, content, picks_version, meta_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, session_id, seq, role, content, picks_version, meta_json, created_at`,
    [sessionId, seq, role, content, picksVersion, meta]
  );
  return rows[0];
}

async function insertPicks(sessionId, picks) {
  const version = await nextPicksVersion(sessionId);
  const { rows } = await pool.query(
    `INSERT INTO hkjc_council_picks (session_id, version, picks_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, session_id, version, picks_json, created_at`,
    [sessionId, version, picks]
  );
  return rows[0];
}

function declaredRunnersOnly(runners) {
  return (Array.isArray(runners) ? runners : []).filter((r) => {
    const no = Number.parseInt(String(r?.no ?? ""), 10);
    return Number.isFinite(no) && no > 0 && !r?.is_standby;
  });
}

async function loadContext(meetingDate, venueCode, raceNo, userMessages) {
  const runnersAll = await fetchRaceRunnersForRace(meetingDate, venueCode, raceNo);
  // Council / picks only use betting horse nos; exclude Standby (後備) which have empty no.
  const runners = declaredRunnersOnly(runnersAll);
  if (!runners?.length) {
    const err = new Error("No runners found for race");
    err.status = 404;
    throw err;
  }
  const meeting = await fetchMeetingWithRunners(meetingDate, venueCode);
  const race = meeting?.races?.find((r) => parseInt(String(r.no), 10) === raceNo) ?? null;
  const built = await buildRaceContext(pool, {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    runners,
    racecardRace: race,
    formRowsPerHorse: 8,
    focusFormRowsPerHorse: 10,
    focused: false,
    pairLimit: 40,
    poolLimit: 30,
  });
  const oddsMomentumBlock = await buildOddsMomentumPromptBlock(pool, {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
  });
  return {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    race_info: race
      ? {
          no: race.no,
          postTime: race.postTime ?? "",
          status: race.status ?? "",
        }
      : null,
    runners,
    oddsSummary: built.oddsSummary,
    pairPools: built.pairPools,
    allPools: built.allPools,
    formByHorse: built.formByHorse,
    oddsMomentumBlock,
    userMessages,
  };
}

async function createSessionRow({ meetingDate, venueCode, raceNo, trigger, startedByUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO hkjc_council_sessions (
      meeting_date, venue_code, race_no, status, trigger, started_by_user_id, started_at_hkt, started_at_utc
    ) VALUES ($1::date, $2, $3, 'running', $4, $5, $6, $7)
    RETURNING *`,
    [meetingDate, venueCode, raceNo, trigger, startedByUserId, formatHktDateTime(), toUtcIso()]
  );
  return rows[0];
}

async function setSessionStopped(sessionId, reason = "manual_stop") {
  await pool.query(
    `UPDATE hkjc_council_sessions
      SET status = 'stopped',
          stop_reason = $2,
          stopped_at_hkt = $3,
          stopped_at_utc = $4
      WHERE id = $1`,
    [sessionId, reason, formatHktDateTime(), toUtcIso()]
  );
}

export function onCouncilEvent(listener) {
  events.on("event", listener);
  return () => events.off("event", listener);
}

function emit(type, payload) {
  events.emit("event", { type, payload });
}

function getActiveState(meetingDate, venueCode, raceNo) {
  return activeSessions.get(raceKey(meetingDate, venueCode, raceNo)) ?? null;
}

async function insertSystemMessage(state, content, meta = {}) {
  const row = await insertMessage(state.session_id, "system", content, {
    speaker: "system",
    speaker_type: "system",
    ...meta,
  });
  emit("agent_message", {
    meeting_date: state.meeting_date,
    venue_code: state.venue_code,
    race_no: state.race_no,
    message: row,
  });
  return row;
}

async function findResumableSession(meetingDate, venueCode, raceNo) {
  const { rows } = await pool.query(
    `SELECT id, stop_reason
     FROM hkjc_council_sessions
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3 AND status = 'stopped'
     ORDER BY id DESC
     LIMIT 1`,
    [meetingDate, venueCode, raceNo]
  );
  const s = rows[0];
  if (!s) return null;
  // Only a manual stop can be resumed; finalized / race-ended sessions stay closed.
  if (String(s.stop_reason ?? "") !== "manual_stop") return null;
  return s;
}

async function loadResumeProgress(sessionId) {
  const { rows } = await pool.query(
    `SELECT meta_json
     FROM hkjc_council_messages
     WHERE session_id = $1 AND role = 'agent' AND meta_json->>'agent_code' = 'bookie'
     ORDER BY seq DESC
     LIMIT 1`,
    [sessionId]
  );
  const meta = rows[0]?.meta_json ?? null;
  return {
    round_no: Number(meta?.round_no ?? 0) || 0,
    next_sequence: Array.isArray(meta?.next_sequence) && meta.next_sequence.length
      ? meta.next_sequence
      : ["quant", "historian", "trend", "scout"],
  };
}

async function reopenSessionRow(sessionId) {
  await pool.query(
    `UPDATE hkjc_council_sessions
      SET status = 'running',
          stop_reason = NULL,
          stopped_at_hkt = NULL,
          stopped_at_utc = NULL
      WHERE id = $1`,
    [sessionId]
  );
}

export async function startCouncilSession({ meetingDate, venueCode, raceNo, trigger = "manual", userId = null }) {
  // Day-level auto-start is now an explicit toggle (setDateActivated); a manual
  // single-race start no longer switches the whole day on.
  const key = raceKey(meetingDate, venueCode, raceNo);
  const existing = activeSessions.get(key);
  if (existing && !existing.stopped) return existing;

  const raceRuntime = await fetchRaceRuntimeInfo(meetingDate, venueCode, raceNo);
  if (raceRuntime.ended) {
    const err = new Error("賽事已結束，無法開始會議");
    err.status = 409;
    throw err;
  }
  const raceStartedByStatus = isRaceStartedStatus(raceRuntime?.race?.status);
  const racePostTimeUtc = parseHktDateTime(meetingDate, raceRuntime?.race?.postTime)?.toISOString() ?? null;
  if (hasReachedPreStartClose({ state: null, racePostTimeUtc, raceStartedByStatus })) {
    const err = new Error("距開跑不足 1 分鐘（或已開跑），不再開新會議");
    err.status = 409;
    throw err;
  }

  const armOddsSync = async (state) => {
    try {
      const armed = await ensureOddsSyncForActiveSessions();
      if (armed?.ok && !armed?.alreadyArmed) {
        await insertSystemMessage(state, "已自動開啟本場即時賠率同步", { event: "odds_sync_armed" }).catch(() => {});
      }
    } catch (err) {
      console.error("[council] arm odds sync failed", err);
    }
  };

  // A manually stopped session can be resumed (same transcript, round numbering
  // continues). The scheduler must not auto-revive it — that would override the
  // user's explicit stop.
  const resumable = await findResumableSession(meetingDate, venueCode, raceNo);
  if (resumable) {
    if (trigger !== "manual") {
      const err = new Error("本場會議已被手動停止，僅手動啟動可恢復");
      err.status = 409;
      throw err;
    }
    await reopenSessionRow(resumable.id);
    const progress = await loadResumeProgress(resumable.id);
    const state = {
      ...makeSessionStateFromRow({
        id: resumable.id,
        meeting_date: meetingDate,
        venue_code: venueCode,
        race_no: raceNo,
      }),
      key,
    };
    state.round_no = progress.round_no;
    state.next_sequence = progress.next_sequence;
    activeSessions.set(key, state);
    emit("session_state", { ...state, status: "running" });
    await insertSystemMessage(
      state,
      `會議恢復：延續先前討論，下一輪 Round ${progress.round_no + 1}`,
      { event: "session_resume" }
    ).catch(() => {});
    await armOddsSync(state);
    return state;
  }

  const session = await createSessionRow({
    meetingDate,
    venueCode,
    raceNo,
    trigger,
    startedByUserId: userId,
  });
  const state = {
    ...makeSessionStateFromRow({
      id: session.id,
      meeting_date: meetingDate,
      venue_code: venueCode,
      race_no: raceNo,
    }),
    key,
  };
  activeSessions.set(key, state);
  emit("session_state", { ...state, status: "running" });

  const postTimeMs = racePostTimeUtc ? new Date(racePostTimeUtc).getTime() : NaN;
  const minsToStart = Number.isFinite(postTimeMs)
    ? Math.max(0, Math.round((postTimeMs - Date.now()) / 60_000))
    : null;
  await insertSystemMessage(state, [
    `會議開始：R${raceNo}`,
    minsToStart != null ? `距開跑約 ${minsToStart} 分鐘` : null,
    "每輪間隔可在上方設定調整，開跑前 1 分鐘結案",
  ].filter(Boolean).join(" · "), { event: "session_start" }).catch(() => {});

  await armOddsSync(state);

  return state;
}

function stopReasonSystemText(reason) {
  if (reason === "pre_start_1m" || reason === "finalized") {
    return "會議結案：FINAL 共識已發布（開跑前 1 分鐘）";
  }
  if (reason === "race_started") return "會議結束：賽事已開跑";
  if (reason === "race_ended") return "會議結束：賽事已結束";
  if (reason === "manual_stop") return "會議已暫停：再按「啟動議會」可延續討論";
  return `會議已結束（${reason}）`;
}

export async function stopCouncilSession({ meetingDate, venueCode, raceNo, reason = "manual_stop" }) {
  const key = raceKey(meetingDate, venueCode, raceNo);
  const state = activeSessions.get(key);
  if (!state) return false;
  state.stopped = true;
  await insertSystemMessage(state, stopReasonSystemText(reason), { event: "session_stop", reason }).catch(() => {});
  await setSessionStopped(state.session_id, reason);
  activeSessions.delete(key);
  try {
    removeIntervalTargets([{ meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo }]);
  } catch (err) {
    console.error("[council] remove odds sync target failed", err);
  }
  emit("session_state", {
    session_id: state.session_id,
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    status: "stopped",
    reason,
  });
  return true;
}

export async function appendUserMessage({ meetingDate, venueCode, raceNo, userId, username, content }) {
  const state = getActiveState(meetingDate, venueCode, raceNo);
  if (!state) {
    const err = new Error("Session not running");
    err.status = 409;
    throw err;
  }
  const row = await insertMessage(state.session_id, "user", content, {
    speaker: "user",
    speaker_type: "user",
    user_id: userId,
    username,
    addressed_agents: parseMentions(content),
    council_member: true,
  });
  state.last_user_seq = row.seq;
  emit("agent_message", {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    message: row,
  });
  return row;
}

async function loadRecentUserMessages(sessionId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, seq, content, meta_json
     FROM hkjc_council_messages
     WHERE session_id = $1 AND role = 'user'
     ORDER BY seq DESC
     LIMIT $2`,
    [sessionId, limit]
  );
  return rows
    .reverse()
    .map((r) => ({ id: r.id, seq: r.seq, content: r.content, ...(r.meta_json ?? {}) }));
}

async function loadRecentTranscript(sessionId, limit = 60) {
  const { rows } = await pool.query(
    `SELECT seq, role, content, meta_json
     FROM hkjc_council_messages
     WHERE session_id = $1
     ORDER BY seq DESC
     LIMIT $2`,
    [sessionId, limit]
  );
  return rows
    .reverse()
    .map((r) => ({
      seq: r.seq,
      role: r.role,
      content: r.content,
      ...(r.meta_json ?? {}),
      speaker: r.meta_json?.speaker ?? (r.role === "user" ? "user" : r.meta_json?.agent_code ?? "agent"),
      round_no: Number(r.meta_json?.round_no ?? 0),
      turn_no: Number(r.meta_json?.turn_no ?? 0),
    }));
}

/** Mark every not-yet-addressed user message up to `upToSeq` as handled, so
 * later rounds stop re-answering old questions. */
async function markUserMessagesAddressed(sessionId, upToSeq, disposition, roundNo) {
  await pool.query(
    `UPDATE hkjc_council_messages
     SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $3::jsonb
     WHERE session_id = $1 AND role = 'user' AND seq <= $2
       AND NOT (COALESCE(meta_json, '{}'::jsonb) ? 'bookie_disposition')`,
    [sessionId, upToSeq, { bookie_disposition: disposition, disposition_round_no: roundNo }]
  );
}

async function loadRecentSessionIdsByRace({ meetingDate, venueCode, raceNo, limit = 20 }) {
  const { rows } = await pool.query(
    `SELECT id, status, trigger, started_at_utc, stopped_at_utc, stop_reason
     FROM hkjc_council_sessions
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
     ORDER BY id DESC
     LIMIT $4`,
    [meetingDate, venueCode, raceNo, limit]
  );
  return rows;
}

async function runLegacyStageRound({ meetingDate, venueCode, raceNo, state }) {
  const userMessages = await loadRecentUserMessages(state.session_id, 20);
  const context = await loadContext(meetingDate, venueCode, raceNo, userMessages);
  const round = await runCouncilRound({
    context,
    userMessages,
    onEvent: (type, data) => {
      emit("stage_event", {
        meeting_date: meetingDate,
        venue_code: venueCode,
        race_no: raceNo,
        stage_type: type,
        data,
      });
    },
  });

  for (const row of round.stage1) {
    const saved = await insertMessage(state.session_id, "agent", row.response, {
      stage: "stage1",
      speaker: row.agent_code,
      speaker_type: "agent",
      agent_code: row.agent_code,
      model: row.model,
    });
    emit("agent_message", { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo, message: saved });
  }
  for (const row of round.stage2) {
    const saved = await insertMessage(state.session_id, "agent", row.ranking, {
      stage: "stage2",
      speaker: row.agent_code,
      speaker_type: "agent",
      agent_code: row.agent_code,
      model: row.model,
      parsed_ranking: row.parsed_ranking,
    });
    emit("agent_message", { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo, message: saved });
  }
  const picksRow = await insertPicks(state.session_id, round.stage3.picks);
  const finalMsg = await insertMessage(
    state.session_id,
    "agent",
    round.stage3.response,
    {
      stage: "stage3",
      speaker: "bookie",
      speaker_type: "agent",
      agent_code: "bookie",
      model: round.stage3.model,
      metadata: round.metadata,
      is_final: true,
    },
    picksRow.version
  );
  emit("agent_message", { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo, message: finalMsg });
  emit("picks_update", {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    picks: picksRow.picks_json,
    version: picksRow.version,
    session_id: state.session_id,
    is_interim: false,
    is_final: true,
  });
  return { round, picks: picksRow };
}

function hasReachedPreStartClose({ state, racePostTimeUtc, raceStartedByStatus }) {
  // If race already started, immediately stop opening new rounds.
  if (raceStartedByStatus) return true;
  const postTimeMs = racePostTimeUtc ? new Date(racePostTimeUtc).getTime() : NaN;
  if (Number.isFinite(postTimeMs)) {
    return Date.now() >= postTimeMs - Math.max(15_000, PRE_START_CLOSE_MS);
  }
  // Fallback: if no post time available but runtime has detected race start, close now.
  return Boolean(state?.race_started_at_utc);
}

async function runChatroomRound({ meetingDate, venueCode, raceNo, state }) {
  const raceRuntime = await fetchRaceRuntimeInfo(meetingDate, venueCode, raceNo);
  if (raceRuntime.ended) {
    await stopCouncilSession({ meetingDate, venueCode, raceNo, reason: "race_ended" });
    return null;
  }
  if (!state.race_started_at_utc && raceRuntime.started_at_utc) {
    state.race_started_at_utc = raceRuntime.started_at_utc;
  }

  const racePostTimeUtc = parseHktDateTime(meetingDate, raceRuntime?.race?.postTime)?.toISOString() ?? null;
  const raceStartedByStatus = isRaceStartedStatus(raceRuntime?.race?.status);
  // The meeting hard-ends the moment the race goes off — no more token spend
  // after 開跑.
  if (raceStartedByStatus) {
    await stopCouncilSession({ meetingDate, venueCode, raceNo, reason: "race_started" });
    return null;
  }
  const shouldFinalize =
    hasReachedPreStartClose({ state, racePostTimeUtc, raceStartedByStatus }) || Boolean(state.finalized);
  if (state.finalized && shouldFinalize) return null;

  const userMessages = await loadRecentUserMessages(state.session_id, 24);
  // Only messages the bookie has not yet dispositioned count as "new" — old
  // questions must not be re-answered round after round.
  const pendingUserMessages = userMessages.filter((m) => !m.bookie_disposition);

  // Adaptive cadence (early-termination research): when consensus has been
  // identical for 2+ rounds and users are silent, run every other round only.
  const stableRounds = Number(state.stable_rounds ?? 0);
  if (!shouldFinalize && !pendingUserMessages.length && stableRounds >= 2 && !state.skipped_last_round) {
    state.skipped_last_round = true;
    return null;
  }
  state.skipped_last_round = false;

  const transcript = await loadRecentTranscript(state.session_id, 80);
  const context = await loadContext(meetingDate, venueCode, raceNo, userMessages);
  const roundNo = Math.max(1, Number(state.round_no ?? 0) + 1);
  const sequence = Array.isArray(state.next_sequence) && state.next_sequence.length ? state.next_sequence : ["quant", "historian", "trend", "scout"];
  const latestUserSeq = userMessages.length ? userMessages[userMessages.length - 1].seq : null;

  let lastSavedSeq = transcript.length ? Number(transcript[transcript.length - 1]?.seq ?? 0) : 0;
  const round = await runCouncilChatroomRound({
    context,
    userMessages,
    pendingUserMessages,
    transcript,
    roundNo,
    sequence,
    latestUserSeq,
    shouldFinalize,
    chairDirectives: state.chair_directives ?? null,
    chairRuling: state.chair_ruling ?? null,
    previousConfidence: state.last_confidence ?? null,
    reloadUserMessages: () => loadRecentUserMessages(state.session_id, 24),
    onEvent: async (type, data) => {
      if (type === "chat_turn_start") {
        emit("typing_update", {
          meeting_date: meetingDate,
          venue_code: venueCode,
          race_no: raceNo,
          session_id: state.session_id,
          is_typing: true,
          speaker: String(data?.agent_code ?? ""),
          round_no: Number(data?.round_no ?? 0),
          turn_no: Number(data?.turn_no ?? 0),
        });
        return;
      }
      if (type === "chat_turn_complete") {
        const replyToSeq = lastSavedSeq > 0 ? lastSavedSeq : null;
        const saved = await insertMessage(state.session_id, "agent", data.response, {
          stage: "chatroom",
          speaker: data.agent_code,
          speaker_type: "agent",
          agent_code: data.agent_code,
          model: data.model,
          round_no: data.round_no,
          turn_no: data.turn_no,
          reply_to_seq: replyToSeq,
          reply_to_speaker: data.reply_to_speaker ?? null,
        });
        lastSavedSeq = saved.seq;
        emit("agent_message", { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo, message: saved });
        emit("typing_update", {
          meeting_date: meetingDate,
          venue_code: venueCode,
          race_no: raceNo,
          session_id: state.session_id,
          is_typing: false,
          speaker: String(data?.agent_code ?? ""),
          round_no: Number(data?.round_no ?? 0),
          turn_no: Number(data?.turn_no ?? 0),
        });
        return;
      }
      if (type === "chat_bookie_start") {
        emit("typing_update", {
          meeting_date: meetingDate,
          venue_code: venueCode,
          race_no: raceNo,
          session_id: state.session_id,
          is_typing: true,
          speaker: "bookie",
          round_no: Number(data?.round_no ?? 0),
          turn_no: Number(data?.turn_no ?? 0),
        });
        return;
      }
      emit("stage_event", {
        meeting_date: meetingDate,
        venue_code: venueCode,
        race_no: raceNo,
        stage_type: type,
        data,
      });
    },
  });

  const picksPayload = {
    ...round.bookie_turn.picks,
    _status: {
      is_interim: !round.bookie_turn.is_final,
      is_final: Boolean(round.bookie_turn.is_final),
      round_no: round.round_no,
    },
  };
  const picksRow = await insertPicks(state.session_id, picksPayload);
  const verdictLabel = { adopt: "採納", partial: "部分採納", reject: "駁回" };
  const verdictLines = (round.bookie_turn.member_verdicts ?? []).map(
    (v) => `- ${v.agent}：${verdictLabel[v.verdict] ?? v.verdict}${v.reason_zh ? ` — ${v.reason_zh}` : ""}`
  );
  const directiveLines = (round.bookie_turn.directives ?? []).map((d) => `- ${d.agent}：${d.task_zh}`);
  const bookieSummaryText = [
    `## Round ${round.round_no} 首席分析總結`,
    round.bookie_turn.round_summary_zh,
    "",
    round.bookie_turn.round_summary_en,
    ...(verdictLines.length ? ["", "**成員評判**", ...verdictLines] : []),
    ...(round.bookie_turn.ruling_zh ? ["", `**裁決** ${round.bookie_turn.ruling_zh}`] : []),
    ...(directiveLines.length ? ["", "**下輪任務**", ...directiveLines] : []),
    "",
    `NEXT_SEQUENCE: ${round.bookie_turn.next_sequence.join(" -> ")}`,
  ].join("\n");
  const savedBookie = await insertMessage(
    state.session_id,
    "agent",
    bookieSummaryText,
    {
      stage: "chatroom",
      speaker: "bookie",
      speaker_type: "agent",
      agent_code: "bookie",
      model: round.bookie_turn.model,
      round_no: round.round_no,
      turn_no: round.bookie_turn.turn_no,
      reply_to_seq: lastSavedSeq > 0 ? lastSavedSeq : null,
      next_sequence: round.bookie_turn.next_sequence,
      round_summary_zh: round.bookie_turn.round_summary_zh,
      round_summary_en: round.bookie_turn.round_summary_en,
      member_verdicts: round.bookie_turn.member_verdicts ?? [],
      ruling_zh: round.bookie_turn.ruling_zh ?? "",
      directives: round.bookie_turn.directives ?? [],
      user_disposition: round.bookie_turn.user_disposition,
      is_interim: !round.bookie_turn.is_final,
      is_final: Boolean(round.bookie_turn.is_final),
    },
    picksRow.version
  );
  emit("agent_message", { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo, message: savedBookie });
  emit("typing_update", {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    session_id: state.session_id,
    is_typing: false,
    speaker: "bookie",
    round_no: Number(round.round_no ?? 0),
    turn_no: Number(round.bookie_turn.turn_no ?? 0),
  });
  emit("picks_update", {
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    picks: picksRow.picks_json,
    version: picksRow.version,
    session_id: state.session_id,
    is_interim: !round.bookie_turn.is_final,
    is_final: Boolean(round.bookie_turn.is_final),
  });

  const dispositionSeq = Number(round.bookie_turn.latest_user_seq ?? 0) > 0
    ? Number(round.bookie_turn.latest_user_seq)
    : latestUserSeq;
  if (dispositionSeq && round.bookie_turn.user_disposition) {
    // Every user message up to this seq has now been answered in this round.
    await markUserMessagesAddressed(
      state.session_id,
      dispositionSeq,
      round.bookie_turn.user_disposition,
      round.round_no
    );
  }

  state.round_no = round.round_no;
  state.next_sequence = round.bookie_turn.next_sequence;
  if (dispositionSeq) state.last_user_seq = dispositionSeq;

  // Carry the chairman's leadership output into the next round's prompts.
  state.chair_ruling = round.bookie_turn.ruling_zh || state.chair_ruling || null;
  state.chair_directives = (round.bookie_turn.directives ?? []).length
    ? round.bookie_turn.directives
    : null;
  const conf = Number(round.bookie_turn.picks?.confidence);
  if (Number.isFinite(conf)) state.last_confidence = conf;
  state.last_round_completed_at = Date.now();
  emitCadenceUpdate(state);

  // Track consensus stability so the scheduler can slow down when nothing changes.
  const consensusKey = JSON.stringify({
    qpl: (round.bookie_turn.picks?.qpl ?? []).map((r) => r.combo),
    others: (round.bookie_turn.picks?.others ?? []).map((r) => `${r.product}|${r.combo}`),
  });
  state.stable_rounds = consensusKey === state.last_consensus_key
    ? Number(state.stable_rounds ?? 0) + 1
    : 0;
  state.last_consensus_key = consensusKey;
  if (round.bookie_turn.is_final) {
    state.finalized = true;
    await stopCouncilSession({
      meetingDate,
      venueCode,
      raceNo,
      reason: shouldFinalize ? "pre_start_1m" : "finalized",
    });
  }
  return { round, picks: picksRow };
}

// Single source of truth for round cadence: the scheduler offers a round every
// tick; this gap (measured from the previous round's END) decides if it runs.

export async function runCouncilRoundForRace({ meetingDate, venueCode, raceNo, force = false, trigger = "unknown" }) {
  const state = getActiveState(meetingDate, venueCode, raceNo);
  if (!state || state.stopped) return null;
  if (state.runningRound) return null;
  // Hard cadence floor: whatever the trigger, never burn a full 5-agent round
  // sooner than the minimum gap unless a user action forced it.
  const sinceLast = Date.now() - Number(state.last_round_completed_at ?? 0);
  const gapMs = getRoundMinGapMsSync();
  if (!force && Number(state.last_round_completed_at ?? 0) > 0 && sinceLast < gapMs) {
    return null;
  }
  state.runningRound = true;
  emitCadenceUpdate(state);
  console.log(
    `[council] round start ${meetingDate}:${venueCode}:R${raceNo} trigger=${trigger} sinceLastMs=${Number(state.last_round_completed_at ?? 0) > 0 ? sinceLast : "n/a"}`
  );
  try {
    if (state.mode === "stage") {
      return await runLegacyStageRound({ meetingDate, venueCode, raceNo, state });
    }
    return await runChatroomRound({ meetingDate, venueCode, raceNo, state });
  } finally {
    state.runningRound = false;
    emitCadenceUpdate(state);
  }
}

export async function getCouncilStatus({ meetingDate, venueCode, raceNo }) {
  let active = getActiveState(meetingDate, venueCode, raceNo);
  const activated = await isDateActivated(meetingDate);
  if (!active) {
    const { rows: sessionRows } = await pool.query(
      `SELECT id, meeting_date, venue_code, race_no, status
       FROM hkjc_council_sessions
       WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
       ORDER BY id DESC
       LIMIT 1`,
      [meetingDate, venueCode, raceNo]
    );
    const latest = sessionRows[0];
    if (latest && latest.status === "running") {
      active = makeSessionStateFromRow(latest);
      activeSessions.set(active.key, active);
    }
  }
  const { rows } = await pool.query(
    `SELECT p.picks_json, p.version, p.created_at
     FROM hkjc_council_sessions s
     JOIN hkjc_council_picks p ON p.session_id = s.id
     WHERE s.meeting_date = $1::date AND s.venue_code = $2 AND s.race_no = $3
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [meetingDate, venueCode, raceNo]
  );
  return {
    activated_date: activated,
    round_min_gap_ms: getRoundMinGapMsSync(),
    round_gap_bounds: getRoundGapBounds(),
    active_session: active
      ? {
          session_id: active.session_id,
          meeting_date: active.meeting_date,
          venue_code: active.venue_code,
          race_no: active.race_no,
          running_round: active.runningRound,
          round_no: Number(active.round_no ?? 0),
          next_sequence: Array.isArray(active.next_sequence) ? active.next_sequence : [],
          race_started_at_utc: active.race_started_at_utc ?? null,
          finalized: Boolean(active.finalized),
          mode: active.mode ?? "chatroom",
          status: active.stopped ? "stopped" : "running",
          last_round_completed_at_ms: Number(active.last_round_completed_at ?? 0),
        }
      : null,
    latest_picks: rows[0]
      ? {
          picks: rows[0].picks_json,
          version: rows[0].version,
          created_at_utc: new Date(rows[0].created_at).toISOString(),
        }
      : null,
  };
}

export async function getMessages({ meetingDate, venueCode, raceNo, sessionId = null, afterSeq = 0 }) {
  let sid = sessionId;
  if (!sid) {
    const active = getActiveState(meetingDate, venueCode, raceNo);
    sid = active?.session_id ?? null;
  }
  if (!sid) {
    // Fallback: after process restart, in-memory activeSessions is empty.
    // Load the latest persisted session so UI can still show conversation history.
    const { rows } = await pool.query(
      `SELECT id
       FROM hkjc_council_sessions
       WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
       ORDER BY id DESC
       LIMIT 1`,
      [meetingDate, venueCode, raceNo]
    );
    sid = rows[0]?.id ?? null;
  }
  if (!sid) return [];
  const { rows } = await pool.query(
    `SELECT id, session_id, seq, role, content, picks_version, meta_json, created_at
     FROM hkjc_council_messages
     WHERE session_id = $1 AND seq > $2
     ORDER BY seq ASC`,
    [sid, Number(afterSeq) || 0]
  );
  return rows.map((r) => ({
    ...r,
    meeting_date: meetingDate,
    venue_code: venueCode,
    race_no: raceNo,
    created_at_utc: new Date(r.created_at).toISOString(),
    created_at_hkt: formatHktDateTime(new Date(r.created_at)),
  }));
}

export async function getSessionHistory({ meetingDate, venueCode, raceNo, limit = 20 }) {
  const sessions = await loadRecentSessionIdsByRace({
    meetingDate,
    venueCode,
    raceNo,
    limit,
  });
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const { rows: statsRows } = await pool.query(
    `SELECT session_id, COUNT(*)::int AS message_count, COALESCE(MAX(seq), 0)::int AS max_seq
     FROM hkjc_council_messages
     WHERE session_id = ANY($1::bigint[])
     GROUP BY session_id`,
    [ids]
  );
  const byId = new Map(statsRows.map((r) => [Number(r.session_id), r]));
  return sessions.map((s) => {
    const stat = byId.get(Number(s.id));
    return {
      session_id: Number(s.id),
      meeting_date: meetingDate,
      venue_code: venueCode,
      race_no: raceNo,
      status: s.status,
      trigger: s.trigger,
      started_at_utc: s.started_at_utc ? new Date(s.started_at_utc).toISOString() : null,
      stopped_at_utc: s.stopped_at_utc ? new Date(s.stopped_at_utc).toISOString() : null,
      stop_reason: s.stop_reason ?? null,
      message_count: Number(stat?.message_count ?? 0),
      max_seq: Number(stat?.max_seq ?? 0),
    };
  });
}

export function getAllActiveSessions() {
  return [...activeSessions.values()];
}

export function getServiceInfo() {
  return {
    today_hkt: formatHktDate(),
    active_sessions: activeSessions.size,
  };
}


import { getHorseRacingApi } from "./lib/hkjcOddsClient.js";
import {
  getAllActiveSessions,
  hydrateActiveSessionsFromDb,
  hydrateRoundGapFromRedis,
  ensureOddsSyncForActiveSessions,
  isDateActivated,
  isRaceStartedStatus,
  runCouncilRoundForRace,
  startCouncilSession,
  stopCouncilSession,
} from "./lib/councilService.js";
import { formatHktDate, isEndedRaceStatus, parseHktDateTime } from "./lib/timeHkt.js";

let timer = null;

function envNum(key, fallback) {
  const n = Number(process.env[key] ?? "");
  return Number.isFinite(n) ? n : fallback;
}

function leadMs() {
  return envNum("COUNCIL_AUTO_START_LEAD_MS", 5 * 60 * 1000);
}

function raceKey(meetingDate, venueCode, raceNo) {
  return `${meetingDate}:${venueCode}:${raceNo}`;
}

function normalizeMeetingDate(rawDate) {
  const text = String(rawDate ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return "";
  return formatHktDate(parsed);
}

function isYmdDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim());
}

function shouldAutoStartRace(now, meetingDate, race) {
  const startAt = parseHktDateTime(meetingDate, race?.postTime);
  if (!startAt) return false;
  if (isEndedRaceStatus(race?.status)) return false;
  return now.getTime() >= startAt.getTime() - leadMs();
}

async function tick() {
  const now = new Date();
  const api = getHorseRacingApi();

  try {
    const meetings = await api.getActiveMeetings();
    for (const meeting of meetings ?? []) {
      const meetingDate = normalizeMeetingDate(meeting.date);
      const venueCode = String(meeting.venueCode ?? "");
      if (!meetingDate || !venueCode) continue;
      const activated = await isDateActivated(meetingDate);
      for (const race of meeting.races ?? []) {
        const raceNo = parseInt(String(race.no), 10);
        if (!Number.isFinite(raceNo)) continue;
        const key = raceKey(meetingDate, venueCode, raceNo);
        if (isEndedRaceStatus(race.status)) {
          await stopCouncilSession({
            meetingDate,
            venueCode,
            raceNo,
            reason: "race_ended",
          });
          continue;
        }
        if (isRaceStartedStatus(race.status)) {
          await stopCouncilSession({
            meetingDate,
            venueCode,
            raceNo,
            reason: "race_started",
          });
          continue;
        }
        if (activated && shouldAutoStartRace(now, meetingDate, race)) {
          try {
            await startCouncilSession({
              meetingDate,
              venueCode,
              raceNo,
              trigger: "auto",
            });
          } catch (e) {
            // Expected near post time (closing window guard); skip this race.
            if (Number(e?.status) !== 409) {
              console.warn(`[councilScheduler] auto-start failed for ${key}:`, e?.message ?? e);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[councilScheduler] meeting poll failed:", e?.message ?? e);
  }

  // Round cadence lives inside runCouncilRoundForRace (min-gap guard); the
  // scheduler just offers a round every tick and the guard decides.
  await ensureOddsSyncForActiveSessions().catch((e) =>
    console.warn("[councilScheduler] odds sync ensure failed:", e?.message ?? e)
  );
  for (const s of getAllActiveSessions()) {
    if (!isYmdDate(s.meeting_date)) {
      await stopCouncilSession({
        meetingDate: s.meeting_date,
        venueCode: s.venue_code,
        raceNo: s.race_no,
        reason: "invalid_meeting_date",
      });
      continue;
    }
    try {
      await runCouncilRoundForRace({
        meetingDate: s.meeting_date,
        venueCode: s.venue_code,
        raceNo: s.race_no,
        trigger: "scheduler",
      });
    } catch (e) {
      console.warn(
        `[councilScheduler] round failed for ${raceKey(s.meeting_date, s.venue_code, s.race_no)}:`,
        e?.message ?? e
      );
    }
  }
}

export function startCouncilScheduler() {
  if (timer) return () => {};
  const everyMs = envNum("COUNCIL_SCHEDULER_TICK_MS", 30_000);
  hydrateRoundGapFromRedis().catch((e) => console.warn("[councilScheduler] round gap hydrate failed:", e?.message ?? e));
  hydrateActiveSessionsFromDb().catch((e) => console.warn("[councilScheduler] hydrate failed:", e?.message ?? e));
  timer = setInterval(() => {
    tick().catch((e) => console.warn("[councilScheduler] tick error", e));
  }, Math.max(5_000, everyMs));
  setTimeout(() => tick().catch(() => {}), 1_000);
  return () => {
    clearInterval(timer);
    timer = null;
  };
}


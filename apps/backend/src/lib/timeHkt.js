const HKT_TZ = "Asia/Hong_Kong";
const HKT_OFFSET_MIN = 8 * 60;

function pad2(v) {
  return String(v).padStart(2, "0");
}

export function formatHktDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: HKT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatHktDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: HKT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

export function toUtcIso(date = new Date()) {
  return new Date(date).toISOString();
}

/** Parse `YYYY-MM-DD` + `HH:mm(:ss)` as HKT, return UTC Date. */
export function parseHktDateTime(meetingDate, rawPostTime) {
  const mDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(meetingDate ?? "").trim());
  if (!mDate) return null;
  const raw = String(rawPostTime ?? "").trim();
  if (!raw) return null;

  const isoCandidate = new Date(raw);
  if (Number.isFinite(isoCandidate.getTime())) return isoCandidate;

  const mTime = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!mTime) return null;
  const year = Number(mDate[1]);
  const month = Number(mDate[2]);
  const day = Number(mDate[3]);
  const hour = Number(mTime[1]);
  const minute = Number(mTime[2]);
  const second = Number(mTime[3] ?? "0");
  if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))) return null;

  const utcMs = Date.UTC(year, month - 1, day, hour - HKT_OFFSET_MIN / 60, minute, second, 0);
  const date = new Date(utcMs);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function hktMidnightMsFromNow(now = new Date()) {
  const ymd = formatHktDate(now);
  const next = parseHktDateTime(ymd, "24:00:00");
  return next?.getTime() ?? now.getTime() + 60 * 60 * 1000;
}

export function msUntilHktMidnight(now = new Date()) {
  return Math.max(1_000, hktMidnightMsFromNow(now) - now.getTime());
}

export function isHktToday(meetingDate, now = new Date()) {
  return String(meetingDate ?? "") === formatHktDate(now);
}

export function isEndedRaceStatus(status) {
  const s = String(status ?? "").toUpperCase();
  if (!s) return false;
  return ["RESULT", "CLOSED", "CANCELLED", "ABANDONED", "VOID", "RACE_RESULT"].some((k) => s.includes(k));
}


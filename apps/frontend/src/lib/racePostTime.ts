const HK_TIME_ZONE = "Asia/Hong_Kong";
const STATUS_ENDED_KEYWORDS = ["RESULT", "CLOSED", "CANCELLED", "ABANDONED", "VOID", "RACE_RESULT"];
const STATUS_LIVE_KEYWORDS = ["RUNNING", "INPLAY", "LIVE", "STARTED", "OFF"];

function parseDateParts(meetingDate: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTimeParts(postTime: string): { hour: number; minute: number; second: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(postTime.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return { hour, minute, second };
}

function pad2(v: number): string {
  return String(v).padStart(2, "0");
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatInTimeZone(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: HK_TIME_ZONE,
    hour12: false,
    ...options,
  }).format(date);
}

function statusIncludesAny(status: string | undefined, keywords: string[]): boolean {
  if (!status) return false;
  const text = status.toUpperCase();
  return keywords.some((key) => text.includes(key));
}

export function parsePostTime(meetingDate: string, postTime: string | undefined): Date | null {
  const raw = String(postTime ?? "").trim();
  if (!meetingDate || !raw) return null;

  const isoCandidate = new Date(raw);
  if (Number.isFinite(isoCandidate.getTime())) {
    return isoCandidate;
  }

  const dateParts = parseDateParts(meetingDate);
  const timeParts = parseTimeParts(raw);
  if (!dateParts || !timeParts) return null;

  const utcMs = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour - 8,
    timeParts.minute,
    timeParts.second,
    0
  );
  const date = new Date(utcMs);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatHkNow(now: Date): string {
  return `${formatInTimeZone(now, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })} (HKT)`;
}

export function formatPostTimeDisplay(startAt: Date | null): string {
  if (!startAt) return "—";
  return `${formatInTimeZone(startAt, {
    hour: "2-digit",
    minute: "2-digit",
  })} (HKT)`;
}

export function getCountdownState(
  now: Date,
  startAt: Date | null,
  status?: string
): { label: string; remainingMs: number | null } {
  if (!startAt) return { label: "—", remainingMs: null };
  if (statusIncludesAny(status, STATUS_ENDED_KEYWORDS)) return { label: "已結束", remainingMs: 0 };
  if (statusIncludesAny(status, STATUS_LIVE_KEYWORDS)) return { label: "進行中", remainingMs: 0 };

  const remainingMs = startAt.getTime() - now.getTime();
  if (!Number.isFinite(remainingMs)) return { label: "—", remainingMs: null };
  if (remainingMs <= 0) return { label: "進行中", remainingMs: 0 };
  return { label: formatDurationMs(remainingMs), remainingMs };
}

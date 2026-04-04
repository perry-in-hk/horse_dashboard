/**
 * HK racing calendar helpers (Asia/Hong_Kong).
 * Default pair: most recent Wednesday and most recent Sunday strictly before today's HK date.
 */

function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function ymdString(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addCalendarDays(y, m, d, delta) {
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** @param {string} ymd YYYY-MM-DD */
function hkWeekdayIndexFromYmd(ymd) {
  const [y, mo, da] = ymd.split("-").map(Number);
  const utcMs = Date.UTC(y, mo - 1, da, 4, 0, 0);
  return new Date(utcMs).getUTCDay();
}

export function getHkYmdString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * @param {number} targetJsWeekday 0=Sun … 3=Wed, 6=Sat
 * @returns {string} YYYY-MM-DD
 */
export function lastWeekdayBeforeTodayHk(targetJsWeekday) {
  let { y, m, d } = parseYmd(getHkYmdString());
  ({ y, m, d } = addCalendarDays(y, m, d, -1));
  for (let i = 0; i < 14; i++) {
    const ymd = ymdString(y, m, d);
    if (hkWeekdayIndexFromYmd(ymd) === targetJsWeekday) return ymd;
    ({ y, m, d } = addCalendarDays(y, m, d, -1));
  }
  throw new Error("Could not find target weekday in HK calendar (last 14 days)");
}

/** Default: most recent Wed + most recent Sun before today (HK). */
export function defaultWedSunIsoHk() {
  return [lastWeekdayBeforeTodayHk(3), lastWeekdayBeforeTodayHk(0)];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s) {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

/** @param {unknown} dates */
export function normalizeHistoricalIsoDates(dates) {
  if (dates == null) return [];
  if (!Array.isArray(dates)) return [];
  const out = [];
  const seen = new Set();
  for (const x of dates) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t || !isValidIsoDate(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

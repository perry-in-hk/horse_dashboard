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

/**
 * Expand inclusive ISO date range to a sorted unique list (max 366 days).
 * @param {string} startIso YYYY-MM-DD
 * @param {string} endIso YYYY-MM-DD
 */
export function expandIsoDateRange(startIso, endIso) {
  const start = typeof startIso === "string" ? startIso.trim() : "";
  const end = typeof endIso === "string" ? endIso.trim() : "";
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    throw new Error("startDate 與 endDate 須為有效 YYYY-MM-DD 格式");
  }
  if (start > end) {
    throw new Error("startDate 不可晚於 endDate");
  }
  const out = [];
  let { y, m, d } = parseYmd(start);
  for (let i = 0; i < 366; i++) {
    const ymd = ymdString(y, m, d);
    out.push(ymd);
    if (ymd === end) return out;
    ({ y, m, d } = addCalendarDays(y, m, d, 1));
  }
  throw new Error("日期區間不可超過 366 日");
}

/**
 * @param {unknown} startDate
 * @param {unknown} endDate
 * @param {unknown} dates legacy explicit list
 */
export function resolveHistoricalIsoDates(startDate, endDate, dates) {
  const hasStart = typeof startDate === "string" && startDate.trim() !== "";
  const hasEnd = typeof endDate === "string" && endDate.trim() !== "";
  if (hasStart || hasEnd) {
    if (!hasStart || !hasEnd) {
      throw new Error("請同時提供 startDate 與 endDate");
    }
    return expandIsoDateRange(startDate, endDate);
  }
  return normalizeHistoricalIsoDates(dates);
}

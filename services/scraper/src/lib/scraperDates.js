/**
 * HK calendar helpers (Asia/Hong_Kong) — keep in sync with apps/backend/src/lib/scraperDates.js
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

export function parseScraperDatesEnv() {
  const raw = process.env.SCRAPER_DATES;
  if (!raw || !raw.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t || !isValidIsoDate(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** YYYY-MM-DD → DD/MM/YYYY for HKJC URLs */
export function isoToDdMmYyyy(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

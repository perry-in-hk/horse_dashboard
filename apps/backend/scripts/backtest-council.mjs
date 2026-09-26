/**
 * Fetch public HKJC local results and score the council pricing card.
 * Closing odds are the bet price. Features use only earlier meetings.
 *
 *   node scripts/backtest-council.mjs
 * Cache: /tmp/hkjc-backtest/races.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as cheerio from "cheerio";
import { TARGET_DATES, toIsoDate } from "../../../services/scraper/src/lib/config.js";
import { walkForward } from "../src/lib/ai/backtestPricing.js";

const CACHE = "/tmp/hkjc-backtest/races.json";
const UA = "Mozilla/5.0 (compatible; hkjc-dashboard-backtest/1.0)";

function isoToParts(iso) {
  const [y, m, d] = iso.split("-");
  return { y, m, d, ddmmyyyy: `${d}/${m}/${y}` };
}

function extraMeetingDates() {
  const out = [];
  const start = new Date("2026-04-02T00:00:00+08:00");
  const end = new Date("2026-09-24T00:00:00+08:00");
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Hong_Kong", weekday: "short" }).format(new Date(t));
    if (weekday === "Wed" || weekday === "Sun") out.push(iso);
  }
  return out;
}

function meetingDates() {
  const set = new Set(TARGET_DATES.map(toIsoDate));
  for (const iso of extraMeetingDates()) set.add(iso);
  return [...set].sort();
}

function resultsUrl(iso, venue, raceNo) {
  const { y, m, d } = isoToParts(iso);
  return `https://racing.hkjc.com/zh-hk/local/information/localresults?racedate=${y}/${m}/${d}&Racecourse=${venue}&RaceNo=${raceNo}`;
}

async function fetchText(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-HK,zh;q=0.9" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw last;
}

function parseMeetings(html) {
  const $ = cheerio.load(html);
  const meetings = [];
  $("table.js_racecard tbody tr").each((_i, tr) => {
    const venueText = $(tr).find("td").first().text().replace(/[:\s]/g, "");
    let racecourse = null;
    if (venueText.includes("沙田")) racecourse = "ST";
    else if (venueText.includes("跑馬地")) racecourse = "HV";
    else {
      const href = $(tr).find("a[href*='Racecourse=']").first().attr("href") || "";
      racecourse = href.match(/Racecourse=(\w+)/)?.[1] ?? null;
    }
    if (!racecourse) return;
    const raceNumbers = [];
    $(tr).find("img").each((_j, img) => {
      const match = String($(img).attr("src") || "").match(/racecard_rt_(\d+)/);
      if (match) raceNumbers.push(Number(match[1]));
    });
    if (raceNumbers.length) meetings.push({ racecourse, raceNumbers: [...new Set(raceNumbers)].sort((a, b) => a - b) });
  });
  return meetings;
}

function parseRace(html, meta) {
  const $ = cheerio.load(html);
  let distance = null;
  let raceClass = null;
  let going = null;
  $("td").each((_i, td) => {
    const text = $(td).text().replace(/\s+/g, " ").trim();
    const dist = text.match(/(\d+)\s*米/);
    if (dist && distance == null) {
      distance = Number(dist[1]);
      raceClass = text.split("-")[0]?.trim() || null;
    }
    if (text.startsWith("場地狀況")) {
      going = $(td).next("td").text().replace(/\s+/g, " ").trim() || null;
    }
  });
  const runners = [];
  $("div.performance > table.draggable tbody tr").each((_i, tr) => {
    const tds = $(tr).find("> td");
    if (tds.length < 8) return;
    const posText = $(tds[0]).text().replace(/\s+/g, " ").trim();
    const posNum = posText.match(/(\d+)/);
    const horseNo = Number.parseInt($(tds[1]).text().trim(), 10);
    const nameText = $(tds[2]).text().replace(/\s+/g, " ").trim();
    const code = nameText.match(/\(([A-Z]\d{3})\)/)?.[1] ?? null;
    const horseName = $(tds[2]).find("a").first().text().trim() || null;
    const jockey = $(tds[3]).text().replace(/\s+/g, " ").trim() || null;
    const trainer = $(tds[4]).text().replace(/\s+/g, " ").trim() || null;
    const draw = Number.parseInt($(tds[7]).text().trim(), 10);
    const odds = Number.parseFloat(String($(tds[11]).text()).replace(/,/g, ""));
    if (!Number.isFinite(horseNo)) return;
    runners.push({
      horse_no: horseNo,
      horse_code: code,
      horse_name: horseName,
      jockey,
      trainer,
      draw: Number.isFinite(draw) ? draw : null,
      finish_position: posNum ? posNum[1] : posText || null,
      win_odds: Number.isFinite(odds) && odds > 1 ? odds : null,
    });
  });
  if (!runners.length) return null;
  return { ...meta, distance, race_class: raceClass, going, runners };
}

async function loadCache() {
  try {
    const raw = await readFile(CACHE, "utf8");
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function discover(iso) {
  for (const venue of ["ST", "HV"]) {
    const html = await fetchText(resultsUrl(iso, venue, 1));
    const meetings = parseMeetings(html);
    if (meetings.length) return { meetings, firstHtml: html, firstVenue: venue };
  }
  return { meetings: [], firstHtml: "", firstVenue: null };
}

async function main() {
  await mkdir("/tmp/hkjc-backtest", { recursive: true });
  const cached = await loadCache();
  const byKey = new Map(cached.map((race) => [`${race.date}|${race.venue}|${race.race_no}`, race]));
  const dates = meetingDates();
  console.log(`meetings to scan: ${dates.length}, cached races: ${byKey.size}`);
  let doneDates = 0;
  for (const iso of dates) {
    const pending = [];
    let found;
    const dayCached = [...byKey.keys()].some((key) => key.startsWith(`${iso}|`));
    if (!dayCached) {
      try {
        found = await discover(iso);
      } catch (err) {
        console.warn(`discover ${iso} failed: ${err.message}`);
        continue;
      }
      for (const meeting of found.meetings) {
        for (const raceNo of meeting.raceNumbers) {
          const key = `${iso}|${meeting.racecourse}|${raceNo}`;
          if (!byKey.has(key)) pending.push({ key, venue: meeting.racecourse, raceNo });
        }
      }
    }
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length) {
        const job = pending[cursor];
        cursor += 1;
        try {
          const html = found && job.venue === found.firstVenue && job.raceNo === 1
            ? found.firstHtml
            : await fetchText(resultsUrl(iso, job.venue, job.raceNo));
          const race = parseRace(html, { date: iso, venue: job.venue, race_no: job.raceNo });
          if (race) byKey.set(job.key, race);
        } catch (err) {
          console.warn(`race ${job.key} failed: ${err.message}`);
        }
      }
    }
    if (pending.length) await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
    doneDates += 1;
    if (pending.length) await writeFile(CACHE, JSON.stringify([...byKey.values()]));
    if (doneDates % 15 === 0) console.log(`scanned ${doneDates}/${dates.length} dates, races ${byKey.size}`);
  }
  const races = [...byKey.values()];
  await writeFile(CACHE, JSON.stringify(races));
  console.log(`races ${races.length}`);
  const report = walkForward(races);
  const sample = report.shipped_test_bets.slice(0, 8);
  const printable = { ...report, shipped_test_bets: sample, shipped_test_bet_count: report.shipped_test_bets.length };
  console.log(JSON.stringify(printable, null, 2));
  await writeFile("/tmp/hkjc-backtest/report.json", JSON.stringify({
    ...report,
    shipped_test_bets: report.shipped_test_bets,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

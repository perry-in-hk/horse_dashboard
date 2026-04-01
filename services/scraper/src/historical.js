import "dotenv/config";
import {
  TARGET_DATES,
  localResultsUrl,
  toIsoDate,
} from "./lib/config.js";
import { fetchPageHtml } from "./lib/fetchPage.js";
import { discoverMeetings } from "./lib/discover.js";
import {
  parseRaceResults,
  parseDividends,
  parseLocalRaceEvents,
} from "./lib/parsers.js";
import {
  getPool,
  closePool,
  upsertRaceResult,
  upsertDividend,
  upsertLocalRaceEvent,
} from "./lib/db.js";

const CONCURRENCY = parseInt(process.env.SCRAPER_CONCURRENCY ?? "1", 10);
const START_DATE = process.env.SCRAPER_START_DATE || null;
const END_DATE = process.env.SCRAPER_END_DATE || null;
const SKIP_SCRAPED = process.env.SCRAPER_SKIP_SCRAPED !== "false";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseDateForCompare(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split("/");
  return new Date(`${y}-${m}-${d}`);
}

function filterDates(dates) {
  let filtered = dates;
  if (START_DATE) {
    const start = new Date(START_DATE);
    filtered = filtered.filter((d) => parseDateForCompare(d) >= start);
  }
  if (END_DATE) {
    const end = new Date(END_DATE);
    filtered = filtered.filter((d) => parseDateForCompare(d) <= end);
  }
  return filtered;
}

async function getAlreadyScrapedDates() {
  const { rows } = await getPool().query(
    `SELECT DISTINCT race_date::text FROM hkjc_race_results`
  );
  return new Set(rows.map((r) => r.race_date));
}

async function processRace(ddmmyyyy, racecourse, raceNo) {
  const url = localResultsUrl(ddmmyyyy, racecourse, raceNo);
  const isoDate = toIsoDate(ddmmyyyy);
  try {
    console.log(`    Scraping race ${racecourse} R${raceNo} ...`);
    const html = await fetchPageHtml(url);

    const results = parseRaceResults(html);
    const dividends = parseDividends(html);
    const events = parseLocalRaceEvents(html);

    let resultCount = 0;
    for (const row of results) {
      if (row.horse_no == null) continue;
      await upsertRaceResult(isoDate, racecourse, raceNo, "local", row);
      resultCount++;
    }

    let divCount = 0;
    for (const row of dividends) {
      await upsertDividend(isoDate, racecourse, raceNo, "local", row);
      divCount++;
    }

    let eventCount = 0;
    for (const row of events) {
      if (row.horse_no == null) continue;
      await upsertLocalRaceEvent(isoDate, racecourse, raceNo, row);
      eventCount++;
    }

    console.log(
      `    Done R${raceNo}: ${resultCount} results, ${divCount} dividends, ${eventCount} events`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    FAILED R${raceNo}: ${msg}`);
  }
}

async function processDate(ddmmyyyy, idx, total) {
  console.log(`\n[${idx}/${total}] [${ddmmyyyy}] Discovering meetings...`);
  let meetings;
  try {
    meetings = await discoverMeetings(ddmmyyyy);
  } catch (err) {
    console.error(`  Could not discover meetings for ${ddmmyyyy}: ${err.message}`);
    return;
  }

  if (meetings.length === 0) {
    console.log(`  No meetings found for ${ddmmyyyy}`);
    return;
  }

  for (const { racecourse, raceNumbers } of meetings) {
    console.log(`  ${racecourse}: races ${raceNumbers.join(",")}`);
    for (const raceNo of raceNumbers) {
      await processRace(ddmmyyyy, racecourse, raceNo);
      await sleep(400);
    }
  }
}

async function main() {
  console.log("=== HKJC Historical Scraper ===");
  console.log(`Database: ${process.env.DATABASE_URL ? "(configured)" : "NOT SET"}`);

  await getPool().query("SELECT 1");
  console.log("DB connection OK");

  let dates = filterDates(TARGET_DATES);
  console.log(`Target dates: ${dates.length} (concurrency=${CONCURRENCY})`);

  if (SKIP_SCRAPED) {
    const scraped = await getAlreadyScrapedDates();
    const before = dates.length;
    dates = dates.filter((d) => !scraped.has(toIsoDate(d)));
    const skipped = before - dates.length;
    if (skipped > 0) {
      console.log(`Skipping ${skipped} already-scraped dates (${dates.length} remaining)`);
    }
  }

  if (dates.length === 0) {
    console.log("All dates already scraped. Nothing to do.");
    await closePool();
    return;
  }

  const overall = new Date();
  const total = dates.length;
  for (let i = 0; i < total; i++) {
    await processDate(dates[i], i + 1, total);
  }

  const elapsed = ((Date.now() - overall.getTime()) / 1000).toFixed(1);
  console.log(`\n=== Finished ${total} dates in ${elapsed}s ===`);

  const { rows } = await getPool().query(
    `SELECT count(*) as results FROM hkjc_race_results`
  );
  console.log(`Total rows in hkjc_race_results: ${rows[0].results}`);

  await closePool();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import "dotenv/config";
import {
  TARGET_DATES,
  localResultsUrl,
  toIsoDate,
} from "./lib/config.js";
import {
  defaultWedSunIsoHk,
  isoToDdMmYyyy,
  parseScraperDatesEnv,
} from "./lib/scraperDates.js";
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
const LEGACY = process.env.SCRAPER_USE_LEGACY_TARGET_LIST === "true";
const STRICT_NO_DUP = process.env.SCRAPER_STRICT_NO_DUPLICATE === "true";

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

/** @param {string[]} isoDates YYYY-MM-DD */
async function findConflictingRaceDates(isoDates) {
  if (isoDates.length === 0) return [];
  const { rows } = await getPool().query(
    `SELECT DISTINCT race_date::text AS d
     FROM (
       SELECT race_date FROM hkjc_race_results WHERE race_date = ANY($1::date[])
       UNION
       SELECT race_date FROM hkjc_dividends WHERE race_date = ANY($1::date[])
       UNION
       SELECT race_date FROM hkjc_local_race_events WHERE race_date = ANY($1::date[])
     ) x
     ORDER BY d`,
    [isoDates]
  );
  return rows.map((r) => r.d);
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

async function runLegacyMode() {
  let dates = filterDates(TARGET_DATES);
  console.log(`Target dates: ${dates.length} (concurrency=${CONCURRENCY}) [legacy list]`);

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
    return;
  }

  const overall = new Date();
  const total = dates.length;
  for (let i = 0; i < total; i++) {
    await processDate(dates[i], i + 1, total);
  }

  const elapsed = ((Date.now() - overall.getTime()) / 1000).toFixed(1);
  console.log(`\n=== Finished ${total} dates in ${elapsed}s ===`);
}

async function runModernMode() {
  let isoDates = parseScraperDatesEnv();
  if (isoDates.length === 0) {
    isoDates = defaultWedSunIsoHk();
    console.log(`No SCRAPER_DATES; using default HK Wed+Sun: ${isoDates.join(", ")}`);
  } else {
    console.log(`SCRAPER_DATES: ${isoDates.join(", ")}`);
  }

  if (STRICT_NO_DUP) {
    const conflicting = await findConflictingRaceDates(isoDates);
    if (conflicting.length > 0) {
      console.error(
        `Scraper aborted: data already exists for race date(s): ${conflicting.join(", ")}`
      );
      process.exit(1);
    }
  }

  const dates = isoDates.map(isoToDdMmYyyy);
  const overall = new Date();
  const total = dates.length;
  for (let i = 0; i < total; i++) {
    await processDate(dates[i], i + 1, total);
  }

  const elapsed = ((Date.now() - overall.getTime()) / 1000).toFixed(1);
  console.log(`\n=== Finished ${total} dates in ${elapsed}s ===`);
}

async function main() {
  console.log("=== HKJC Historical Scraper ===");
  console.log(`Database: ${process.env.DATABASE_URL ? "(configured)" : "NOT SET"}`);

  await getPool().query("SELECT 1");
  console.log("DB connection OK");

  if (LEGACY) {
    console.log("Mode: SCRAPER_USE_LEGACY_TARGET_LIST=true (full TARGET_DATES + optional filters)");
    await runLegacyMode();
  } else {
    console.log("Mode: date list from SCRAPER_DATES or default Wed/Sun (HK)");
    await runModernMode();
  }

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

import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { horseDetailUrl, HORSE_DETAIL_YEARS } from "./lib/config.js";
import { fetchPageHtml } from "./lib/fetchPage.js";
import { parseHorseProfile, parseHorseRaceHistory } from "./lib/horseParser.js";
import {
  getPool,
  closePool,
  upsertHorseDetail,
  upsertHorseRaceHistory,
} from "./lib/db.js";

const argv = process.argv.slice(2);
/** CLI: --refresh | --all | --no-skip → re-scrape every horse (ignore DB skip). */
const FORCE_REFRESH =
  argv.includes("--refresh") ||
  argv.includes("--all") ||
  argv.includes("--no-skip");

/**
 * Skip horses already in hkjc_horse_details (resume).
 * Env: SCRAPER_HORSE_DETAILS_SKIP_SCRAPED, or legacy SCRAPER_SKIP_SCRAPED if unset.
 * Skip=true (default): true, 1, yes, on, or empty.
 * Skip=false: false, 0, no, off, all, refresh, full, rescan.
 */
function envSaysSkipScraped() {
  const raw =
    process.env.SCRAPER_HORSE_DETAILS_SKIP_SCRAPED !== undefined
      ? process.env.SCRAPER_HORSE_DETAILS_SKIP_SCRAPED
      : process.env.SCRAPER_SKIP_SCRAPED;
  if (raw === undefined || raw === "") return true;
  const v = String(raw).trim().toLowerCase();
  if (["false", "0", "no", "off", "all", "refresh", "full", "rescan"].includes(v)) {
    return false;
  }
  return true;
}

const SKIP_SCRAPED = FORCE_REFRESH ? false : envSaysSkipScraped();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadHorseCodes() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.resolve(__dirname, "../../../horse_codes_unique.txt");
  const text = await readFile(filePath, "utf-8");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function getAlreadyScrapedCodes() {
  const { rows } = await getPool().query(
    `SELECT horse_code FROM hkjc_horse_details`
  );
  return new Set(rows.map((r) => r.horse_code));
}

/**
 * Try each year (newest first) until a valid horse page is found.
 * Returns { html, horseid, year } or null if no valid page exists.
 */
async function findHorsePage(horseCode) {
  for (const year of HORSE_DETAIL_YEARS) {
    const url = horseDetailUrl(horseCode, year);
    try {
      const html = await fetchPageHtml(url);
      const profile = parseHorseProfile(html);
      if (profile && profile.horse_code === horseCode) {
        return { html, horseid: `HK_${year}_${horseCode}`, year };
      }
    } catch {
      // Page fetch failed (404, timeout, etc.) — try next year
    }
    await sleep(300);
  }
  return null;
}

async function processHorse(horseCode, idx, total) {
  console.log(`  [${idx}/${total}] ${horseCode}: searching...`);

  const found = await findHorsePage(horseCode);
  if (!found) {
    console.log(`  [${idx}/${total}] ${horseCode}: NOT FOUND on any year`);
    return;
  }

  const { html, horseid } = found;
  const profile = parseHorseProfile(html);
  const history = parseHorseRaceHistory(html);

  await upsertHorseDetail(horseid, profile);

  let histCount = 0;
  for (const row of history) {
    if (row.race_meeting == null && row.race_date == null) continue;
    await upsertHorseRaceHistory(profile.horse_code, profile.horse_name, row);
    histCount++;
  }

  console.log(
    `  [${idx}/${total}] ${horseCode} (${horseid}): profile OK, ${histCount} races`
  );
}

async function main() {
  console.log("=== HKJC Horse Details Scraper ===");
  console.log(
    `Database: ${process.env.DATABASE_URL ? "(configured)" : "NOT SET"}`
  );

  await getPool().query("SELECT 1");
  console.log("DB connection OK");

  if (FORCE_REFRESH) {
    console.log(
      "Mode: FULL REFRESH (--refresh) — re-scraping all horses from the list"
    );
  } else if (SKIP_SCRAPED) {
    console.log(
      "Mode: SKIP SCRAPED — only horses not yet in hkjc_horse_details (set SCRAPER_HORSE_DETAILS_SKIP_SCRAPED=false or use --refresh to update existing)"
    );
  } else {
    console.log(
      "Mode: FULL LIST — SCRAPER_HORSE_DETAILS_SKIP_SCRAPED=false (re-scrape / upsert every horse)"
    );
  }

  let codes = await loadHorseCodes();
  console.log(`Loaded ${codes.length} horse codes from file`);

  if (SKIP_SCRAPED) {
    const scraped = await getAlreadyScrapedCodes();
    const before = codes.length;
    codes = codes.filter((c) => !scraped.has(c));
    const skipped = before - codes.length;
    if (skipped > 0) {
      console.log(
        `Skipping ${skipped} already-scraped horses (${codes.length} remaining)`
      );
    }
  }

  if (codes.length === 0) {
    console.log("All horses already scraped. Nothing to do.");
    await closePool();
    return;
  }

  const overall = Date.now();
  const total = codes.length;

  for (let i = 0; i < total; i++) {
    try {
      await processHorse(codes[i], i + 1, total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${total}] ${codes[i]}: ERROR - ${msg}`);
    }
    await sleep(400);
  }

  const elapsed = ((Date.now() - overall) / 1000).toFixed(1);
  console.log(`\n=== Finished ${total} horses in ${elapsed}s ===`);

  const { rows: detailRows } = await getPool().query(
    `SELECT count(*) as cnt FROM hkjc_horse_details`
  );
  const { rows: histRows } = await getPool().query(
    `SELECT count(*) as cnt FROM hkjc_horse_race_history`
  );
  console.log(`Total horse profiles: ${detailRows[0].cnt}`);
  console.log(`Total race history rows: ${histRows[0].cnt}`);

  await closePool();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

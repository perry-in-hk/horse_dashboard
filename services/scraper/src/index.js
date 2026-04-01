import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import cron from "node-cron";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sourceUrl = process.env.HKJC_SOURCE_URL ?? "https://racing.hkjc.com";

async function scrapeAndStore() {
  try {
    const response = await axios.get(sourceUrl, { timeout: 10000 });
    const $ = cheerio.load(response.data);
    const title = $("title").first().text().trim() || "No page title";
    console.log(`Scraper heartbeat: ${title}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Scraper run failed:", message);
  }
}

await pool.query("SELECT 1");
await scrapeAndStore();
cron.schedule("*/5 * * * *", scrapeAndStore);
console.log("Scraper scheduled every 5 minutes (historical data: use historical.js)");

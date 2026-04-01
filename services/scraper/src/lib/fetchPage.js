import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink, mkdir } from "fs/promises";
import path from "path";
import axios from "axios";

const execAsync = promisify(exec);

const FIRECRAWL_DIR = ".firecrawl";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_BUFFER = 20 * 1024 * 1024;

const USE_FIRECRAWL = process.env.SCRAPER_USE_FIRECRAWL === "true";

let dirCreated = false;

async function ensureFirecrawlDir() {
  if (dirCreated) return;
  await mkdir(FIRECRAWL_DIR, { recursive: true });
  dirCreated = true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithFirecrawl(url) {
  await ensureFirecrawlDir();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpFile = path.join(FIRECRAWL_DIR, `scrape-${stamp}.html`);

  await execAsync(
    `firecrawl scrape "${url}" --format rawHtml -o "${tmpFile}"`,
    { maxBuffer: MAX_BUFFER, timeout: 60_000 }
  );
  const html = await readFile(tmpFile, "utf-8");
  await unlink(tmpFile).catch(() => {});
  if (!html || html.length < 200) {
    throw new Error("Firecrawl returned empty/short content");
  }
  return html;
}

async function fetchWithAxios(url) {
  const resp = await axios.get(url, {
    timeout: 30_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
    },
    responseType: "text",
  });
  if (!resp.data || resp.data.length < 200) {
    throw new Error("Axios returned empty/short content");
  }
  return resp.data;
}

/**
 * Fetch page HTML with retry/backoff.
 * Uses Firecrawl CLI when SCRAPER_USE_FIRECRAWL=true, otherwise axios.
 */
export async function fetchPageHtml(url) {
  const fetcher = USE_FIRECRAWL ? fetchWithFirecrawl : fetchWithAxios;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetcher(url);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `  [fetchPage] attempt ${attempt} failed for ${url}: ${err.message}, retrying in ${delay}ms`
        );
        await sleep(delay);
      }
    }
  }
  throw new Error(
    `Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

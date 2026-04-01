import * as cheerio from "cheerio";
import { fetchPageHtml } from "./fetchPage.js";
import { localResultsUrl } from "./config.js";

/**
 * Given a race date (DD/MM/YYYY), discover which racecourses ran that day.
 * Tries ST page first; if no meetings found, tries HV page separately
 * (HKJC only shows venue nav on the matching venue's URL).
 *
 * Returns array of { racecourse, raceNumbers: [1,2,...] } objects.
 */
export async function discoverMeetings(ddmmyyyy) {
  const allMeetings = [];

  for (const venue of ["ST", "HV"]) {
    const url = localResultsUrl(ddmmyyyy, venue, 1);
    let html;
    try {
      html = await fetchPageHtml(url);
    } catch {
      continue;
    }
    const found = parseMeetingsFromNav(html);
    for (const m of found) {
      if (!allMeetings.some((x) => x.racecourse === m.racecourse)) {
        allMeetings.push(m);
      }
    }
  }

  return allMeetings;
}

/**
 * Parse the top race-number navigation bar from a results page.
 * The nav contains rows like:
 *   沙田: [1] [2] [3] ... [11] [全日]
 * or:
 *   跑馬地: [1] [2] ... [8] [全日]
 * Each race is an <img> with src containing racecard_rt_N.gif
 *
 * Also extracts racecourse from href query params as a fallback
 * when the venue label text doesn't match known patterns.
 */
export function parseMeetingsFromNav(html) {
  const $ = cheerio.load(html);
  const meetings = [];

  $("table.js_racecard tbody tr").each((_i, tr) => {
    const venueCell = $(tr).find("td").first();
    const venueText = venueCell.text().trim().replace(/[:\s]/g, "");

    let racecourse;
    if (venueText.includes("沙田")) racecourse = "ST";
    else if (venueText.includes("跑馬地")) racecourse = "HV";
    else {
      const firstLink = $(tr).find("a[href*='Racecourse=']").first().attr("href") || "";
      const m = firstLink.match(/Racecourse=(\w+)/);
      if (m) racecourse = m[1];
      else return;
    }

    const raceNumbers = [];
    $(tr)
      .find("img")
      .each((_j, img) => {
        const src = $(img).attr("src") || "";
        const match = src.match(/racecard_rt_(\d+)/);
        if (match) raceNumbers.push(parseInt(match[1], 10));
      });

    if (raceNumbers.length > 0) {
      raceNumbers.sort((a, b) => a - b);
      meetings.push({ racecourse, raceNumbers });
    }
  });

  return meetings;
}

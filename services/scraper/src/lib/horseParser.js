import * as cheerio from "cheerio";

/**
 * Parse horse profile metadata from the sidebar tables.
 * Returns a flat object or null if the page has no valid horse data.
 */
export function parseHorseProfile(html) {
  const $ = cheerio.load(html);

  const titleEl = $("table.horseProfile span.title_text").first();
  if (!titleEl.length) return null;

  const titleText = titleEl.text().trim();
  const nameMatch = titleText.match(/^(.+?)\s*\(([A-Z]\d{3})\)/);
  if (!nameMatch) return null;

  const horseName = nameMatch[1].trim();
  const horseCode = nameMatch[2];

  const profile = { horse_name: horseName, horse_code: horseCode };

  $("table.table_top_right.table_eng_text tr").each((_i, tr) => {
    const tds = $(tr).find("> td");
    if (tds.length < 3) return;
    const label = $(tds[0]).text().replace(/\s+/g, " ").trim();
    const value = $(tds[2]).text().replace(/\s+/g, " ").trim();

    if (label.includes("出生地") && label.includes("馬齡")) {
      const parts = value.split("/").map((s) => s.trim());
      profile.origin = parts[0] || null;
      profile.age = parseInt(parts[1], 10) || null;
    } else if (label.includes("毛色") && label.includes("性別")) {
      const parts = value.split("/").map((s) => s.trim());
      profile.color = parts[0] || null;
      profile.sex = parts[1] || null;
    } else if (label.includes("進口類別")) {
      profile.import_type = value || null;
    } else if (label.includes("今季獎金")) {
      profile.season_stake = value || null;
    } else if (label.includes("總獎金")) {
      profile.total_stake = value || null;
    } else if (label.includes("冠") && label.includes("總出賽")) {
      const m = value.match(/(\d+)-(\d+)-(\d+)-(\d+)/);
      if (m) {
        profile.wins = parseInt(m[1], 10);
        profile.seconds = parseInt(m[2], 10);
        profile.thirds = parseInt(m[3], 10);
        profile.total_starts = parseInt(m[4], 10);
      }
    } else if (label.includes("最近十個賽馬日")) {
      profile.recent_runs = parseInt(value, 10) || null;
    } else if (label.includes("現在位置")) {
      const locMatch = value.match(/^(.+?)\s*\((.+?)\)/);
      if (locMatch) {
        profile.current_location = locMatch[1].trim();
        profile.arrival_date = locMatch[2].trim();
      } else {
        profile.current_location = value || null;
      }
    } else if (label.includes("進口日期")) {
      profile.import_date = value || null;
    } else if (label === "練馬師") {
      profile.trainer = value || null;
    } else if (label === "馬主") {
      profile.owner = value || null;
    } else if (label === "現時評分") {
      profile.current_rating = parseInt(value, 10) || null;
    } else if (label === "季初評分") {
      profile.season_start_rating = parseInt(value, 10) || null;
    }
  });

  return profile;
}

/**
 * Parse the race history table from the horse detail page.
 * Returns array of race row objects.
 */
export function parseHorseRaceHistory(html) {
  const $ = cheerio.load(html);
  const rows = [];
  let currentSeason = null;

  $("table.bigborder tr").each((_i, tr) => {
    const $tr = $(tr);

    if ($tr.find("td.hsubheader").length > 0) return;

    const seasonSpan = $tr.find("span.htable_bold_text");
    if (seasonSpan.length > 0) {
      currentSeason = seasonSpan.text().trim();
      return;
    }

    const tds = $tr.find("> td");
    if (tds.length < 18) return;

    const raceMeeting = parseInt($(tds[0]).text().trim(), 10) || null;
    const position = $(tds[1]).text().trim() || null;
    const raceDate = $(tds[2]).text().trim() || null;
    const venueTrack = $(tds[3]).text().replace(/&quot;/g, '"').replace(/\s+/g, " ").trim() || null;
    const distance = parseInt($(tds[4]).text().trim(), 10) || null;
    const going = $(tds[5]).text().trim() || null;
    const raceClass = $(tds[6]).text().trim() || null;
    const draw = parseInt($(tds[7]).text().trim(), 10) || null;
    const rating = parseInt($(tds[8]).text().trim(), 10) || null;
    const trainer = $(tds[9]).text().trim() || null;
    const jockey = $(tds[10]).text().trim() || null;
    const lbw = $(tds[11]).text().trim() || null;
    const winOddsRaw = $(tds[12]).text().trim();
    const winOdds = winOddsRaw ? parseFloat(winOddsRaw) || null : null;
    const actualWeight = parseInt($(tds[13]).text().trim(), 10) || null;
    const runningPositions = $(tds[14]).text().trim() || null;
    const finishTime = $(tds[15]).text().trim() || null;
    const declaredWeight = parseInt($(tds[16]).text().trim(), 10) || null;
    const gear = $(tds[17]).text().trim() || null;

    if (raceMeeting == null && position == null) return;

    rows.push({
      season: currentSeason,
      race_meeting: raceMeeting,
      position,
      race_date: raceDate,
      venue_track: venueTrack,
      distance,
      going,
      race_class: raceClass,
      draw,
      rating,
      trainer,
      jockey,
      lbw,
      win_odds: winOdds,
      actual_weight: actualWeight,
      running_positions: runningPositions,
      finish_time: finishTime,
      declared_weight: declaredWeight,
      gear: gear === "--" ? null : gear,
    });
  });

  return rows;
}

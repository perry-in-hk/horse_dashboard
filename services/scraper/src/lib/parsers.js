import * as cheerio from "cheerio";

/**
 * Parse the main results table (div.performance > table.draggable).
 * Returns array of runner objects.
 */
export function parseRaceResults(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("div.performance > table.draggable tbody tr").each((_i, tr) => {
    const tds = $(tr).find("> td");
    if (tds.length < 8) return;

    const posText = $(tds[0]).text().trim().replace(/\s+/g, " ");
    const finishPosition = posText.replace(/^\d+\s*/, "").trim() || posText;

    const horseNo = parseInt($(tds[1]).text().trim(), 10) || null;

    const nameCell = $(tds[2]);
    const horseName = nameCell.find("a").first().text().trim() || null;
    const nameText = nameCell.text().trim();
    const codeMatch = nameText.match(/\(([A-Z]\d{3})\)/);
    const horseCode = codeMatch ? codeMatch[1] : null;

    const jockey = $(tds[3]).text().trim() || null;
    const trainer = $(tds[4]).text().trim() || null;

    const actualWeight = parseInt($(tds[5]).text().trim(), 10) || null;
    const declaredWeight = parseInt($(tds[6]).text().trim(), 10) || null;

    const draw = parseInt($(tds[7]).text().trim(), 10) || null;
    const margin = $(tds[8]).text().trim() || null;

    let runningPositions = null;
    const runPosCell = tds[9];
    if (runPosCell) {
      const positions = [];
      $(runPosCell)
        .find("div div")
        .each((_j, d) => {
          const v = $(d).text().trim();
          if (v) positions.push(v);
        });
      if (positions.length > 0) {
        runningPositions = positions.join(" ");
      }
    }

    const finishTime = tds[10] ? $(tds[10]).text().trim() || null : null;
    const winOddsRaw = tds[11] ? $(tds[11]).text().trim() : null;
    const winOdds = winOddsRaw ? parseFloat(winOddsRaw) || null : null;

    rows.push({
      finish_position: finishPosition || null,
      horse_no: horseNo,
      horse_name: horseName,
      horse_code: horseCode,
      jockey,
      trainer,
      actual_weight: actualWeight,
      declared_weight: declaredWeight,
      draw,
      margin,
      running_positions: runningPositions,
      finish_time: finishTime,
      win_odds: winOdds,
    });
  });

  return rows;
}

/**
 * Parse the dividends table (div.dividend_tab table.table_bd).
 * Handles rowspan on pool names.
 * Returns array of { pool, combination, payout_hkd }.
 */
export function parseDividends(html) {
  const $ = cheerio.load(html);
  const rows = [];
  let currentPool = null;

  $("div.dividend_tab table.table_bd tbody tr").each((_i, tr) => {
    const tds = $(tr).find("> td");
    if (tds.length === 0) return;

    if (tds.length >= 3) {
      currentPool = $(tds[0]).text().trim();
      const combination = $(tds[1]).text().trim();
      const payoutRaw = $(tds[2]).text().trim().replace(/,/g, "");
      const payout = parseFloat(payoutRaw) || null;
      if (combination) {
        rows.push({ pool: currentPool, combination, payout_hkd: payout });
      }
    } else if (tds.length === 2 && currentPool) {
      const combination = $(tds[0]).text().trim();
      const payoutRaw = $(tds[1]).text().trim().replace(/,/g, "");
      const payout = parseFloat(payoutRaw) || null;
      if (combination) {
        rows.push({ pool: currentPool, combination, payout_hkd: payout });
      }
    }
  });

  return rows;
}

/**
 * Parse the race event report table (div.race_incident_report table.table_bd).
 * Returns array of { finish_position, horse_no, horse_name, horse_code, event_text }.
 */
export function parseLocalRaceEvents(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("div.race_incident_report table.table_bd tbody tr").each((_i, tr) => {
    const tds = $(tr).find("> td");
    if (tds.length < 4) return;

    const finishPosition = $(tds[0]).text().trim() || null;
    const horseNo = parseInt($(tds[1]).text().trim(), 10) || null;

    const nameCell = $(tds[2]);
    const horseName = nameCell.find("a").first().text().trim() || null;
    const nameText = nameCell.text().trim();
    const codeMatch = nameText.match(/\(([A-Z]\d{3})\)/);
    const horseCode = codeMatch ? codeMatch[1] : null;

    const eventText = $(tds[3]).text().trim() || null;

    rows.push({
      finish_position: finishPosition,
      horse_no: horseNo,
      horse_name: horseName,
      horse_code: horseCode,
      event_text: eventText,
    });
  });

  return rows;
}

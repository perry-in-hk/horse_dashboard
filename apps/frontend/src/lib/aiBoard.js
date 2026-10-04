/** Pre-off board math for 智能分析. Result-page win odds are never an input. */

export const NO_PREOFF_QUOTE = "未有開跑前報價";

/**
 * @param {unknown} raw
 * @returns {{ horseNo: number, odds: number }[]}
 */
export function parseWinQuotes(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  /** @type {{ horseNo: number, odds: number }[]} */
  const quotes = [];
  for (const pool of value) {
    if (String(pool?.oddsType ?? "").toUpperCase().trim() !== "WIN") continue;
    const nodes = Array.isArray(pool?.oddsNodes) ? pool.oddsNodes : [];
    for (const node of nodes) {
      const horseNo = parseInt(String(node?.combString ?? "").trim(), 10);
      if (!Number.isFinite(horseNo) || horseNo <= 0) continue;
      const odds = parseFloat(String(node?.oddsValue ?? "").replace(/,/g, ""));
      if (!Number.isFinite(odds) || odds <= 0) continue;
      quotes.push({ horseNo, odds });
    }
  }
  return quotes;
}

/**
 * Lowest win odds is the favourite. Ties break toward the smaller horse number.
 * @param {{ horseNo: number, odds: number }[]} quotes
 * @returns {{ favourite: { horseNo: number, odds: number }, second: { horseNo: number, odds: number } } | null}
 */
export function pickFavouriteAndSecond(quotes) {
  /** @type {Map<number, { horseNo: number, odds: number }>} */
  const best = new Map();
  for (const quote of quotes) {
    if (!Number.isFinite(quote?.horseNo) || quote.horseNo <= 0) continue;
    if (!Number.isFinite(quote?.odds) || quote.odds <= 0) continue;
    const prev = best.get(quote.horseNo);
    if (!prev || quote.odds < prev.odds) {
      best.set(quote.horseNo, { horseNo: quote.horseNo, odds: quote.odds });
    }
  }
  const ranked = [...best.values()].sort((a, b) => a.odds - b.odds || a.horseNo - b.horseNo);
  if (ranked.length < 2) return null;
  return { favourite: ranked[0], second: ranked[1] };
}

/**
 * Latest snapshot strictly before post time. If post time is unknown, the latest stored snapshot.
 * Snapshots at or after post time are not pre-off prices.
 * @param {{ observed_at: string, payload?: unknown }[] | null | undefined} snapshots
 * @param {number | null | undefined} postTimeMs
 * @returns {{ snapshot: { observed_at: string, payload?: unknown }, mode: "before-post" | "latest" } | null}
 */
export function choosePreOffSnapshot(snapshots, postTimeMs) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const valid = list.filter((row) => row && Number.isFinite(Date.parse(row.observed_at)));
  if (!valid.length) return null;
  valid.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  if (postTimeMs == null || !Number.isFinite(postTimeMs)) {
    return { snapshot: valid[valid.length - 1], mode: "latest" };
  }
  const before = valid.filter((row) => Date.parse(row.observed_at) < postTimeMs);
  if (!before.length) return null;
  return { snapshot: before[before.length - 1], mode: "before-post" };
}

/**
 * @param {{ observed_at: string, payload?: unknown }[] | null | undefined} snapshots
 * @param {number | null | undefined} postTimeMs
 * @param {unknown} [_resultPageWinOdds] ignored on purpose — never shown as pre-off prices
 */
export function boardPricesFromSnapshots(snapshots, postTimeMs, _resultPageWinOdds) {
  const chosen = choosePreOffSnapshot(snapshots, postTimeMs);
  if (!chosen) {
    return {
      label: NO_PREOFF_QUOTE,
      favourite: null,
      second: null,
      observedAt: null,
      mode: null,
    };
  }
  const pair = pickFavouriteAndSecond(parseWinQuotes(chosen.snapshot.payload));
  if (!pair) {
    return {
      label: NO_PREOFF_QUOTE,
      favourite: null,
      second: null,
      observedAt: chosen.snapshot.observed_at,
      mode: chosen.mode,
    };
  }
  return {
    label: null,
    favourite: pair.favourite,
    second: pair.second,
    observedAt: chosen.snapshot.observed_at,
    mode: chosen.mode,
  };
}

function venueKey(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return "";
  if (text === "ST" || text === "SHA TIN" || text.includes("沙田")) return "ST";
  if (text === "HV" || text === "HAPPY VALLEY" || text.includes("跑馬地")) return "HV";
  return text;
}

function dateKey(value) {
  return String(value ?? "").slice(0, 10);
}

function positionInt(row) {
  if (row?.position_int != null && Number.isFinite(Number(row.position_int)) && Number(row.position_int) > 0) {
    return Number(row.position_int);
  }
  const parsed = parseInt(String(row?.finish_position ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Same-venue same-distance record, recent runs, and today's draw.
 * Figures come only from supplied history rows (Analysis compare / horse history shape).
 * @param {object[] | null | undefined} rows
 * @param {{ venueCode?: string, meetingDate?: string, raceNo?: number, distance?: number | null, draw?: number | null }} ctx
 */
export function summarizeHorseForm(rows, ctx) {
  const list = Array.isArray(rows) ? rows : [];
  const meetingDate = dateKey(ctx?.meetingDate);
  const raceNo = Number(ctx?.raceNo);
  const venue = venueKey(ctx?.venueCode);
  const isThisRace = (row) => dateKey(row?.race_date) === meetingDate && Number(row?.race_no) === raceNo;
  const prior = list.filter((row) => !isThisRace(row));
  const todayRow = list.find((row) => isThisRace(row));
  const ctxDistance = Number(ctx?.distance);
  const rowDistance = Number(todayRow?.race_distance);
  const distance = Number.isFinite(ctxDistance) && ctxDistance > 0
    ? ctxDistance
    : Number.isFinite(rowDistance) && rowDistance > 0
      ? rowDistance
      : null;
  const ctxDraw = Number(ctx?.draw);
  const rowDraw = Number(todayRow?.draw);
  const draw = Number.isFinite(ctxDraw) && ctxDraw > 0
    ? ctxDraw
    : Number.isFinite(rowDraw) && rowDraw > 0
      ? rowDraw
      : null;

  let sameVenueDistance;
  if (distance == null) {
    sameVenueDistance = "無法計算：沒有今場途程";
  } else if (!prior.some((row) => Number(row?.race_distance) > 0)) {
    sameVenueDistance = prior.length ? "無法計算：往績沒有途程" : "無法計算：沒有今場以前的往績";
  } else if (!venue) {
    sameVenueDistance = "無法計算：沒有場地";
  } else {
    const matched = prior.filter(
      (row) => venueKey(row?.racecourse) === venue && Number(row?.race_distance) === distance
    );
    const starts = matched.length;
    const wins = matched.filter((row) => positionInt(row) === 1).length;
    const top3 = matched.filter((row) => {
      const pos = positionInt(row);
      return pos != null && pos <= 3;
    }).length;
    sameVenueDistance = `${distance}米 · ${starts}戰${wins}冠${top3}次前三`;
  }

  const recentSorted = [...prior].sort((a, b) => {
    const byDate = dateKey(b?.race_date).localeCompare(dateKey(a?.race_date));
    if (byDate !== 0) return byDate;
    return Number(b?.race_no) - Number(a?.race_no);
  });
  const recent = recentSorted.length
    ? recentSorted
        .slice(0, 5)
        .map((row) => {
          const text = String(row?.finish_position ?? "").trim();
          return text || "—";
        })
        .join("/")
    : "無法計算：沒有今場以前的往績";

  return {
    sameVenueDistance,
    recent,
    draw: draw != null ? `今場 ${draw} 檔` : "無法計算今場檔位",
  };
}

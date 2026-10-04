/**
 * Pure helpers for the council packet and pre-off prices.
 * Result-page / settlement win_odds are never copied into today's price.
 */

export const NO_PREOFF_QUOTE = "未有開跑前報價";
export const NO_LATE_MONEY = "未有臨場";

export function trendLineForSnapshotCount(snapshotCount) {
  const n = Number(snapshotCount);
  if (!Number.isFinite(n) || n < 2) return NO_LATE_MONEY;
  return "";
}

function emptyText(value) {
  return String(value ?? "").trim();
}

export function postTimeMs(meetingDate, postTime) {
  const raw = String(postTime ?? "").trim();
  if (!raw) return null;
  if (/[Tt]/.test(raw) || /[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    const direct = Date.parse(raw);
    return Number.isFinite(direct) ? direct : null;
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(meetingDate ?? "").trim());
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!date || !time) {
    const direct = Date.parse(raw);
    return Number.isFinite(direct) ? direct : null;
  }
  const utc = Date.UTC(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    Number(time[1]) - 8,
    Number(time[2]),
    Number(time[3] ?? 0)
  );
  return Number.isFinite(utc) ? utc : null;
}

function parseOddsNum(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function poolsOf(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

export function winPlaFromPayload(payload) {
  const win = {};
  const pla = {};
  for (const pool of poolsOf(payload)) {
    const type = String(pool?.oddsType ?? "").toUpperCase().trim();
    if (type !== "WIN" && type !== "PLA") continue;
    const target = type === "WIN" ? win : pla;
    for (const node of pool?.oddsNodes ?? []) {
      const comb = String(node?.combString ?? "").trim();
      const odds = parseOddsNum(node?.oddsValue);
      if (!comb || odds == null) continue;
      target[comb] = odds;
    }
  }
  return { win, pla };
}

export function choosePreOffSnapshot(snapshots, postTime) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter(
    (row) => row && Number.isFinite(Date.parse(row.observed_at))
  );
  if (!list.length) return null;
  list.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  if (postTime == null || !Number.isFinite(postTime)) {
    return { snapshot: list[list.length - 1], mode: "latest" };
  }
  const before = list.filter((row) => Date.parse(row.observed_at) < postTime);
  if (!before.length) return null;
  return { snapshot: before[before.length - 1], mode: "before-post" };
}

/**
 * Today's prices come only from a pre-off snapshot.
 * `resultWinOdds` and `racecardWin` are accepted and ignored so callers cannot
 * accidentally treat settlement or racecard fallbacks as the pre-off price.
 */
export function buildPreOffOddsSummary({ snapshots, postTimeMs: postMs, resultWinOdds: _resultWinOdds, racecardWin: _racecardWin } = {}) {
  const chosen = choosePreOffSnapshot(snapshots, postMs);
  if (!chosen) {
    return {
      source: "none",
      observed_at: null,
      win: {},
      pla: {},
      note: NO_PREOFF_QUOTE,
      preoff: false,
    };
  }
  const { win, pla } = winPlaFromPayload(chosen.snapshot.payload);
  if (!Object.keys(win).length && !Object.keys(pla).length) {
    return {
      source: "none",
      observed_at: chosen.snapshot.observed_at ?? null,
      win: {},
      pla: {},
      note: NO_PREOFF_QUOTE,
      preoff: false,
    };
  }
  return {
    source: "snapshot",
    observed_at: chosen.snapshot.observed_at ?? null,
    win,
    pla,
    note: "",
    preoff: true,
    mode: chosen.mode,
  };
}

function jockeyText(runner) {
  if (typeof runner?.jockey === "string") return emptyText(runner.jockey);
  const named = runner?.jockey_name ?? runner?.jockey?.name_ch ?? runner?.jockey?.name_en ?? "";
  return emptyText(named);
}

function drawText(runner) {
  const raw = runner?.draw ?? runner?.barrierDrawNumber ?? "";
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

/**
 * Every runner keeps jockey, draw, venue, and course keys.
 * Missing values are empty strings, never omitted.
 */
export function shapeRunnerForPacket(runner, meta = {}) {
  const venue = emptyText(meta.venueCode ?? meta.venue ?? runner?.venue ?? runner?.venue_code);
  const course = emptyText(meta.course ?? runner?.course ?? "");
  return {
    ...(runner && typeof runner === "object" ? runner : {}),
    jockey: jockeyText(runner),
    draw: drawText(runner),
    venue,
    course,
  };
}

export function shapeRunnersForPacket(runners, meta = {}) {
  return (Array.isArray(runners) ? runners : []).map((runner) => shapeRunnerForPacket(runner, meta));
}

export function formatRunnerLine(runner, odds = {}) {
  const shaped = shapeRunnerForPacket(runner, {
    venueCode: runner?.venue,
    course: runner?.course,
  });
  const no = parseInt(String(runner?.no ?? runner?.horseNo ?? "").trim(), 10);
  const name = emptyText(runner?.horse_name ?? runner?.name) || "?";
  const win = odds.win == null || odds.win === "" ? "" : String(odds.win);
  const pla = odds.pla == null || odds.pla === "" ? "" : String(odds.pla);
  return `#${Number.isFinite(no) ? no : "?"} ${name} | jockey=${shaped.jockey} | draw=${shaped.draw} | venue=${shaped.venue} | course=${shaped.course} | WIN ${win} | PLA ${pla}`;
}

export function sameCourseDistanceLabel(rows, venue, distance) {
  const dist = Number(distance);
  const course = emptyText(venue).toUpperCase();
  if (!course || !Number.isFinite(dist) || dist <= 0) return "";
  const list = Array.isArray(rows) ? rows : [];
  const withDistance = list.filter((row) => Number(row?.race_distance) > 0);
  if (!withDistance.length) return "";
  const matched = withDistance.filter(
    (row) => emptyText(row?.racecourse).toUpperCase() === course && Number(row.race_distance) === dist
  );
  const wins = matched.filter((row) => {
    const pos = row?.position_int != null ? Number(row.position_int) : parseInt(String(row?.finish_position ?? ""), 10);
    return pos === 1;
  }).length;
  return `${dist}米 ${matched.length}戰${wins}冠`;
}

export function formatFormHorseLine({ horseNo, horseName, jockey, draw, venue, rows, distance, recent }) {
  const shaped = shapeRunnerForPacket(
    { jockey, draw, venue, course: "" },
    { venueCode: venue }
  );
  const record = sameCourseDistanceLabel(rows, shaped.venue, distance);
  return `#${horseNo} ${horseName} | jockey=${shaped.jockey} | draw=${shaped.draw} | venue=${shaped.venue} | same_course_distance=${record} | recent=${recent || ""}`;
}

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { HorseRacingAPI, HKJCClient, horseQuery } = require("@gikndue/hkjc-api");

let instance = null;

export function getHorseRacingApi() {
  if (!instance) instance = new HorseRacingAPI();
  return instance;
}

/**
 * Full meeting for date+venue (racecard with runners + winOdds). Used when pmPools oddsNodes are empty.
 * @param {string} date YYYY-MM-DD
 * @param {string} venueCode e.g. ST, HV
 */
export async function fetchMeetingWithRunners(date, venueCode) {
  const client = new HKJCClient();
  const response = await client.request(horseQuery, { date, venueCode });
  const meetings = response.raceMeetings;
  if (!Array.isArray(meetings) || meetings.length === 0) return null;
  return meetings[0];
}

/**
 * Map a GraphQL racecard runner (see horseQuery runners fields) to API shape.
 * Declared runners use `no` (saddle / betting horse number, matches WIN combString).
 * Standby (後備) runners have empty `no` and a `standbyNo` — never coerce that to 0.
 * @param {unknown} ru
 * @returns {{
 *   no: number | null,
 *   horse_name: string,
 *   horse_code: string,
 *   status: string,
 *   is_standby: boolean,
 *   standby_no: number | null
 * }}
 */
export function normalizeRacecardRunner(ru) {
  const parsedNo = parseInt(String(ru?.no ?? "").trim(), 10);
  const no = Number.isFinite(parsedNo) && parsedNo > 0 ? parsedNo : null;
  const parsedStandby = parseInt(String(ru?.standbyNo ?? "").trim(), 10);
  const standby_no = Number.isFinite(parsedStandby) && parsedStandby > 0 ? parsedStandby : null;
  const status = String(ru?.status ?? "").trim();
  const is_standby = status.toUpperCase() === "STANDBY" || no == null;
  const code = String(ru?.horse?.code ?? "").trim().toUpperCase();
  const name =
    String(ru?.name_en ?? ru?.name_ch ?? "")
      .trim()
      .replace(/\s+/g, " ") || code || "";
  return {
    no,
    horse_name: name || "?",
    horse_code: code,
    status,
    is_standby,
    standby_no,
  };
}

/**
 * Runners for one race from live racecard (HKJC GraphQL).
 * @param {string} meetingDate YYYY-MM-DD
 * @param {string} venueCode
 * @param {number} raceNo
 * @returns {Promise<{
 *   no: number | null,
 *   horse_name: string,
 *   horse_code: string,
 *   status: string,
 *   is_standby: boolean,
 *   standby_no: number | null
 * }[] | null>}
 *   `null` if meeting or race is missing.
 */
export async function fetchRaceRunnersForRace(meetingDate, venueCode, raceNo) {
  const meeting = await fetchMeetingWithRunners(meetingDate, venueCode);
  if (!meeting) return null;
  const race = meeting.races?.find((r) => parseInt(String(r.no), 10) === raceNo);
  if (!race) return null;
  const runners = (race.runners ?? [])
    .map(normalizeRacecardRunner)
    .filter((r) => r.horse_code);
  runners.sort((a, b) => {
    if (a.is_standby !== b.is_standby) return a.is_standby ? 1 : -1;
    if (a.is_standby) return (a.standby_no ?? 99) - (b.standby_no ?? 99);
    return (a.no ?? 0) - (b.no ?? 0);
  });
  return runners;
}

function poolHasNodes(pool) {
  return Array.isArray(pool?.oddsNodes) && pool.oddsNodes.length > 0;
}

function hasAnyOddsNodes(pmPools) {
  return Array.isArray(pmPools) && pmPools.some(poolHasNodes);
}

/**
 * When HKJC returns empty pmPools or empty oddsNodes (e.g. before pool opens), use runner winOdds from racecard.
 * @param {unknown[]} pmPools
 * @param {string} date
 * @param {string} venueCode
 * @param {number} raceNo
 * @param {string[]} oddsTypes
 */
export async function mergePayloadWithRunnerFallback(pmPools, date, venueCode, raceNo, oddsTypes) {
  const pools = Array.isArray(pmPools) ? [...pmPools] : [];
  if (hasAnyOddsNodes(pools)) return pools;

  let meeting;
  try {
    meeting = await fetchMeetingWithRunners(date, venueCode);
  } catch (err) {
    console.warn("[hkjcOdds] fetchMeetingWithRunners failed:", err?.message ?? err);
    return pools;
  }

  const race = meeting?.races?.find((r) => parseInt(String(r.no), 10) === raceNo);
  if (!race?.runners?.length) return pools;

  if (oddsTypes.includes("WIN")) {
    const winNodes = race.runners
      .map((ru) => {
        const no = parseInt(String(ru?.no ?? "").trim(), 10);
        if (!Number.isFinite(no) || no <= 0) return null;
        return {
          combString: String(no),
          oddsValue: ru.winOdds,
        };
      })
      .filter((n) => n && n.oddsValue != null && n.oddsValue !== "");

    if (winNodes.length > 0) {
      const idx = pools.findIndex((p) => p.oddsType === "WIN");
      if (idx >= 0) {
        pools[idx] = { ...pools[idx], oddsType: "WIN", oddsNodes: winNodes };
      } else {
        pools.push({ oddsType: "WIN", oddsNodes: winNodes });
      }
    }
  }

  return pools;
}

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
      .map((ru) => ({
        combString: String(ru.no ?? "").trim() || "?",
        oddsValue: ru.winOdds,
      }))
      .filter((n) => n.oddsValue != null && n.oddsValue !== "");

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

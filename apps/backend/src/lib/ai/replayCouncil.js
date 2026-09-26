/**
 * Build a pre-race council context from cached local results.
 * The current race's finish positions are never copied onto the context.
 */

import { applyResidual, formatPricingBlock, impliedWinProbs, residualFromStats } from "./pricingCard.js";
import { formatHandicapBlock } from "./handicapCard.js";
import { statsForRunner } from "./backtestPricing.js";
import { comboLegs, judgePick, parseFinishPosition } from "./council/scorecard.js";

export const REPLAY_TARGETS = [
  { date: "2026-07-12", venue: "ST", race_no: 5 },
  { date: "2026-07-12", venue: "ST", race_no: 7 },
  { date: "2026-07-12", venue: "ST", race_no: 8 },
  { date: "2026-07-12", venue: "ST", race_no: 10 },
  { date: "2026-02-14", venue: "ST", race_no: 6 },
  { date: "2026-04-19", venue: "ST", race_no: 6 },
  { date: "2026-06-10", venue: "HV", race_no: 6 },
  { date: "2026-09-13", venue: "ST", race_no: 6 },
];

export function replayKey(race) {
  return `${race.date}|${race.venue}|${race.race_no}`;
}

const TARGET_KEYS = new Set(REPLAY_TARGETS.map(replayKey));

export function isReplayTarget(race) {
  return TARGET_KEYS.has(replayKey(race));
}

export function createReplayMemory() {
  return { byCode: new Map(), trainerRuns: [] };
}

function addDays(iso, days) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function rememberRace(memory, race) {
  for (const runner of race.runners ?? []) {
    const code = String(runner.horse_code ?? "").trim().toUpperCase();
    const position = runner.finish_position ?? null;
    if (code) {
      const list = memory.byCode.get(code) ?? [];
      list.push({
        race_date: race.date,
        venue_track: race.venue,
        distance: race.distance ?? null,
        race_class: race.race_class ?? null,
        going: race.going ?? null,
        draw: runner.draw ?? null,
        jockey: runner.jockey ?? null,
        position,
        win_odds: runner.win_odds ?? null,
      });
      memory.byCode.set(code, list);
    }
    if (runner.trainer) {
      const pos = parseFinishPosition(position);
      memory.trainerRuns.push({ date: race.date, trainer: runner.trainer, win: pos === 1 });
    }
  }
  const cutoff = addDays(race.date, -130);
  if (memory.trainerRuns.length > 4000 && memory.trainerRuns[0].date < cutoff) {
    memory.trainerRuns = memory.trainerRuns.filter((row) => row.date >= cutoff);
  }
}

export function trainerWindow(runs, name, date) {
  const cutoff = addDays(date, -120);
  let sample = 0;
  let wins = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const row = runs[i];
    if (row.date < cutoff) break;
    if (row.trainer !== name) continue;
    sample += 1;
    if (row.win) wins += 1;
  }
  return { sample, win_rate: sample ? wins / sample : null };
}

function recentRuns(memory, horseCode) {
  const code = String(horseCode ?? "").trim().toUpperCase();
  const list = memory.byCode.get(code) ?? [];
  return list.slice(-5).reverse();
}

export function buildReplayContext(race, history, memory) {
  const runners = (race.runners ?? []).map((runner) => ({
    no: runner.horse_no,
    horse_name: runner.horse_name ?? "",
    horse_code: runner.horse_code ?? "",
    draw: runner.draw ?? null,
    jockey: runner.jockey ?? null,
    trainer: runner.trainer ?? null,
  }));
  const win = {};
  for (const runner of race.runners ?? []) {
    if (runner.horse_no && Number(runner.win_odds) > 1) win[String(runner.horse_no)] = Number(runner.win_odds);
  }
  const market = impliedWinProbs(win);
  const stats = {};
  const adjustments = {};
  for (const runner of race.runners ?? []) {
    const no = String(runner.horse_no ?? "");
    if (!no) continue;
    const base = statsForRunner(history, runner, race);
    const trainer = runner.trainer ? trainerWindow(memory.trainerRuns, runner.trainer, race.date) : { sample: 0, win_rate: null };
    stats[no] = {
      horse_code: runner.horse_code ?? "",
      jockey: runner.jockey ?? null,
      trainer: runner.trainer ?? null,
      draw: runner.draw ?? null,
      weight: null,
      rating: null,
      recent: recentRuns(memory, runner.horse_code),
      ...base,
      trainer_sample: trainer.sample,
      trainer_win_rate: trainer.win_rate,
    };
    adjustments[no] = residualFromStats(no, { [no]: stats[no] });
  }
  const pricing = applyResidual(market, adjustments);
  const raceMeta = {
    venue: race.venue,
    distance: race.distance ?? null,
    raceClass: race.race_class ?? null,
    going: race.going ?? null,
  };
  const formByHorse = runners
    .filter((runner) => runner.horse_code)
    .map((runner) => ({
      horse_code: runner.horse_code,
      horse_name: runner.horse_name,
      rows: recentRuns(memory, runner.horse_code).map((row) => ({ finish_position: row.position })),
    }));
  return {
    meeting_date: race.date,
    venue_code: race.venue,
    race_no: race.race_no,
    runners,
    oddsSummary: {
      source: "historical_closing_win",
      observed_at: `${race.date} closing`,
      win,
      pla: {},
    },
    pairPools: { source: "none", observed_at: null, qin: [], qpl: [] },
    allPools: { pools: {} },
    formByHorse,
    raceMeta,
    handicapBlock: formatHandicapBlock({ raceMeta, runners, stats }),
    pricing,
    pricingBlock: formatPricingBlock(pricing),
    oddsMomentumBlock:
      "沒有逐口賠率。此獨贏價是該場結算前賠率，本重播把它當作當時現價。位置、連贏、位置Q 賠率缺，這些彩池不能放行。負磅與評分在這份歷史頁缺。",
  };
}

function winPrice(race, combo) {
  const legs = comboLegs(combo);
  if (legs.length !== 1) return null;
  const runner = (race.runners ?? []).find((row) => Number(row.horse_no) === legs[0]);
  const odds = Number(runner?.win_odds);
  return odds > 1 ? odds : null;
}

function scoreLine(race, product, row, positions, finisherCount) {
  const combo = String(row?.combo ?? "");
  const outcome = judgePick({ product, combo, positions, finisherCount });
  const sp = String(product).toUpperCase() === "WIN" ? winPrice(race, combo) : null;
  let unit_return = null;
  if (String(product).toUpperCase() === "WIN") {
    if (outcome === "hit" && sp) unit_return = Math.round((sp - 1) * 1000) / 1000;
    else if (outcome === "miss") unit_return = -1;
  }
  return {
    product: String(product).toUpperCase(),
    combo,
    stated_odds: row?.odds ?? "",
    closing_odds: sp,
    outcome,
    unit_return,
  };
}

export function scoreReplay(race, picks) {
  const positions = new Map();
  for (const runner of race.runners ?? []) {
    const pos = parseFinishPosition(runner.finish_position);
    if (pos) positions.set(Number(runner.horse_no), pos);
  }
  const finisherCount = positions.size;
  const lines = [];
  for (const row of picks?.qpl ?? []) lines.push(scoreLine(race, "QPL", row, positions, finisherCount));
  for (const row of picks?.others ?? []) lines.push(scoreLine(race, row?.product || "WIN", row, positions, finisherCount));
  const winLines = lines.filter((line) => line.product === "WIN" && line.unit_return != null);
  const favourite = [...(race.runners ?? [])]
    .filter((runner) => Number(runner.win_odds) > 1)
    .sort((a, b) => Number(a.win_odds) - Number(b.win_odds) || Number(a.horse_no) - Number(b.horse_no))[0];
  const favPos = favourite ? positions.get(Number(favourite.horse_no)) : null;
  const favHit = favPos === 1;
  return {
    lines,
    win: {
      bets: winLines.length,
      hits: winLines.filter((line) => line.outcome === "hit").length,
      unit_return_sum: Math.round(winLines.reduce((acc, line) => acc + line.unit_return, 0) * 1000) / 1000,
    },
    favourite: favourite
      ? {
          horse_no: favourite.horse_no,
          odds: Number(favourite.win_odds),
          hit: favHit,
          unit_return: Math.round((favHit ? Number(favourite.win_odds) - 1 : -1) * 1000) / 1000,
        }
      : null,
    winner: [...positions.entries()].find(([, pos]) => pos === 1)?.[0] ?? null,
  };
}

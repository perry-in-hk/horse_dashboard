/**
 * Replay one closing council round as if the race were still open.
 * Finish positions stay out of the prompt and are applied only after the slip.
 *
 *   node --env-file=/workspace/.env scripts/replay-council.mjs
 *
 * Cache: /tmp/hkjc-backtest/races.json
 * Report: /tmp/hkjc-backtest/replay-report.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHistory, commitRace } from "../src/lib/ai/backtestPricing.js";
import { runCouncilChatroomRound } from "../src/lib/ai/council/orchestrator.js";
import {
  REPLAY_TARGETS,
  buildReplayContext,
  createReplayMemory,
  isReplayTarget,
  rememberRace,
  replayKey,
  scoreReplay,
} from "../src/lib/ai/replayCouncil.js";

const CACHE = "/tmp/hkjc-backtest/races.json";
const REPORT = "/tmp/hkjc-backtest/replay-report.json";

function sortRaces(races) {
  return [...races].sort((a, b) =>
    a.date === b.date ? (a.venue === b.venue ? a.race_no - b.race_no : a.venue.localeCompare(b.venue)) : a.date.localeCompare(b.date)
  );
}

async function probeModels() {
  const { callAgentChat } = await import("../src/lib/ai/council/callAgent.js");
  const flash = await callAgentChat({
    system: "Reply with the single word ok.",
    user: "ping",
    model: "deepseek-flash",
    max_tokens: 16,
  });
  const pro = await callAgentChat({
    system: "Reply with the single word ok.",
    user: "ping",
    model: "deepseek-v4-pro",
    max_tokens: 16,
    finalChair: true,
  });
  console.log(`probe flash=${flash.model} pro=${pro.model}`);
}

async function replayOne(race, history, memory) {
  const context = buildReplayContext(race, history, memory);
  for (const runner of context.runners) {
    if ("finish_position" in runner) throw new Error(`finish leaked into ${replayKey(race)}`);
  }
  const round = await runCouncilChatroomRound({
    context,
    userMessages: [],
    pendingUserMessages: [],
    transcript: [],
    roundNo: 1,
    shouldFinalize: true,
    skipAnalysts: false,
  });
  const picks = round.bookie_turn?.picks ?? { qpl: [], others: [] };
  const scored = scoreReplay(race, picks);
  const usage = [ ...(round.analyst_turns ?? []).map((turn) => turn.usage), round.bookie_turn?.usage ].filter(Boolean);
  return {
    key: replayKey(race),
    date: race.date,
    venue: race.venue,
    race_no: race.race_no,
    models: {
      analysts: [...new Set((round.analyst_turns ?? []).map((turn) => turn.model))],
      bookie: round.bookie_turn?.model ?? null,
    },
    summary_zh: picks.summary_zh ?? "",
    confidence: picks.confidence ?? null,
    picks: scored.lines,
    win: scored.win,
    favourite: scored.favourite,
    winner: scored.winner,
    usage,
  };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error("Missing DEEPSEEK_API_KEY/OPENAI_API_KEY");
  }
  await probeModels();
  const races = sortRaces(JSON.parse(await readFile(CACHE, "utf8")));
  const history = createHistory();
  const memory = createReplayMemory();
  const wanted = new Set(REPLAY_TARGETS.map(replayKey));
  const seen = new Set();
  const results = [];
  const dates = [...new Set(races.map((race) => race.date))];
  for (const date of dates) {
    const day = races.filter((race) => race.date === date);
    for (const race of day) {
      if (!isReplayTarget(race)) continue;
      const key = replayKey(race);
      console.log(`replay ${key}`);
      try {
        const row = await replayOne(race, history, memory);
        results.push(row);
        seen.add(key);
        console.log(
          `  slip win ${row.win.hits}/${row.win.bets} unit ${row.win.unit_return_sum} fav ${row.favourite?.horse_no}@${row.favourite?.odds} winner #${row.winner}`
        );
      } catch (err) {
        const status = Number(err?.status ?? 0);
        results.push({ key, error: String(err?.message ?? err), status: status || null });
        console.error(`  failed ${key}: ${err?.message ?? err}`);
        if (status === 401) throw err;
      }
    }
    for (const race of day) {
      commitRace(history, race);
      rememberRace(memory, race);
    }
  }
  const missing = [...wanted].filter((key) => !seen.has(key));
  const winBets = results.flatMap((row) => (row.picks ?? []).filter((line) => line.product === "WIN" && line.unit_return != null));
  const winHits = winBets.filter((line) => line.outcome === "hit").length;
  const winSum = winBets.reduce((acc, line) => acc + line.unit_return, 0);
  const favs = results.map((row) => row.favourite).filter(Boolean);
  const favSum = favs.reduce((acc, row) => acc + row.unit_return, 0);
  const report = {
    races: results.length,
    missing,
    win: {
      bets: winBets.length,
      hits: winHits,
      unit_return_sum: Math.round(winSum * 1000) / 1000,
      roi: winBets.length ? Math.round((1000 * winSum) / winBets.length) / 1000 : null,
    },
    favourite: {
      bets: favs.length,
      hits: favs.filter((row) => row.hit).length,
      unit_return_sum: Math.round(favSum * 1000) / 1000,
      roi: favs.length ? Math.round((1000 * favSum) / favs.length) / 1000 : null,
    },
    results,
  };
  await writeFile(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ missing, win: report.win, favourite: report.favourite }, null, 2));
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});

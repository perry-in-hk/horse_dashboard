import test from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "./backtestPricing.js";
import { buildReplayContext, createReplayMemory, rememberRace, scoreReplay } from "./replayCouncil.js";

function race(overrides = {}) {
  return {
    date: "2026-07-12",
    venue: "ST",
    race_no: 5,
    distance: 1200,
    race_class: "第四班",
    going: "好地",
    runners: [
      { horse_no: 10, horse_code: "A111", horse_name: "長勝", jockey: "甲", trainer: "練甲", draw: 2, finish_position: "1", win_odds: 25 },
      { horse_no: 3, horse_code: "B222", horse_name: "熱門", jockey: "乙", trainer: "練乙", draw: 5, finish_position: "2", win_odds: 2.3 },
      { horse_no: 7, horse_code: "C333", horse_name: "冷門", jockey: "丙", trainer: "練丙", draw: 9, finish_position: "10", win_odds: 40 },
    ],
    ...overrides,
  };
}

test("replay context hides the current finish", () => {
  const memory = createReplayMemory();
  rememberRace(memory, {
    date: "2026-06-01",
    venue: "ST",
    race_no: 1,
    distance: 1200,
    race_class: "第四班",
    going: "好地",
    runners: [{ horse_no: 1, horse_code: "A111", horse_name: "長勝", jockey: "甲", trainer: "練甲", draw: 1, finish_position: "3", win_odds: 5 }],
  });
  const current = race();
  const context = buildReplayContext(current, createHistory(), memory);
  const dumped = JSON.stringify(context.runners);
  assert.equal(dumped.includes("finish_position"), false);
  assert.equal(dumped.includes('"1"'), false);
  assert.equal(context.runners.find((row) => row.no === 10).horse_name, "長勝");
  assert.match(context.handicapBlock, /2026-06-01/);
  assert.doesNotMatch(context.handicapBlock, /名次1/);
  assert.equal(context.pricing.find((row) => row.no === "3").odds, 2.3);
});

test("replay scores win slips from closing odds after the meeting", () => {
  const current = race();
  const scored = scoreReplay(current, {
    qpl: [],
    others: [
      { product: "WIN", combo: "10", odds: "25" },
      { product: "WIN", combo: "3", odds: "2.3" },
    ],
  });
  assert.equal(scored.winner, 10);
  assert.equal(scored.lines[0].outcome, "hit");
  assert.equal(scored.lines[0].unit_return, 24);
  assert.equal(scored.lines[1].outcome, "miss");
  assert.equal(scored.lines[1].unit_return, -1);
  assert.equal(scored.win.bets, 2);
  assert.equal(scored.win.hits, 1);
  assert.equal(scored.favourite.horse_no, 3);
  assert.equal(scored.favourite.hit, false);
});

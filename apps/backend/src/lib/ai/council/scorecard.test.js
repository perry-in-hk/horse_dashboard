import assert from "node:assert/strict";
import test from "node:test";
import { judgePick, parseFinishPosition, scoreSlip, summarizeSettlements } from "./scorecard.js";

test("parseFinishPosition treats 10 as tenth", () => {
  assert.equal(parseFinishPosition("10"), 10);
  assert.equal(parseFinishPosition("1"), 1);
  assert.equal(parseFinishPosition("WV"), null);
});

test("July 12 Sha Tin R7 win pick misses and place on the winner hits", () => {
  const positions = new Map([
    [3, 1],
    [6, 2],
    [5, 3],
    [10, 4],
  ]);
  assert.equal(judgePick({ product: "WIN", combo: "10", positions, finisherCount: 12 }), "miss");
  assert.equal(judgePick({ product: "PLA", combo: "3", positions, finisherCount: 12 }), "hit");
  assert.equal(judgePick({ product: "QPL", combo: "3-10", positions, finisherCount: 12 }), "miss");
  assert.equal(judgePick({ product: "QPL", combo: "3-5", positions, finisherCount: 12 }), "hit");
  assert.equal(judgePick({ product: "FCT", combo: "10-3", positions, finisherCount: 12 }), "miss");
});

test("scoreSlip uses dividend payout for a hit and -1 for a miss", () => {
  const lines = scoreSlip({
    picks: {
      confidence: 0.75,
      qpl: [{ combo: "1-2", odds: "8" }],
      others: [{ product: "WIN", combo: "9", odds: "4" }],
    },
    results: [
      { horse_no: 1, finish_position: "1", win_odds: 3 },
      { horse_no: 2, finish_position: "2", win_odds: 5 },
      { horse_no: 3, finish_position: "3", win_odds: 8 },
      { horse_no: 9, finish_position: "4", win_odds: 6 },
      { horse_no: 4, finish_position: "5", win_odds: 10 },
      { horse_no: 5, finish_position: "6", win_odds: 12 },
      { horse_no: 6, finish_position: "7", win_odds: 15 },
    ],
    dividends: [{ pool: "位置Q", combination: "2,1", payout_hkd: 80 }],
  });
  assert.equal(lines[0].outcome, "hit");
  assert.equal(lines[0].unit_return, 7);
  assert.equal(lines[1].outcome, "miss");
  assert.equal(lines[1].unit_return, -1);
  const summary = summarizeSettlements(lines);
  assert.equal(summary.hits, 1);
  assert.equal(summary.misses, 1);
});

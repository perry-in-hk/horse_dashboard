import assert from "node:assert/strict";
import test from "node:test";
import { commitRace, createHistory, statsForRunner, walkForward } from "./backtestPricing.js";

test("a horse's own result is not in the pre-race sample", () => {
  const history = createHistory();
  const race = {
    date: "2025-01-01",
    venue: "ST",
    race_no: 1,
    distance: 1200,
    runners: [
      { horse_no: 1, horse_code: "A001", jockey: "騎師甲", draw: 1, finish_position: "1", win_odds: 3 },
    ],
  };
  const before = statsForRunner(history, race.runners[0], race);
  assert.equal(before.cd_sample, 0);
  commitRace(history, race);
  const after = statsForRunner(history, race.runners[0], { ...race, date: "2025-02-01" });
  assert.equal(after.cd_sample, 1);
  assert.equal(after.cd_top3_rate, 1);
});

test("walk-forward favourite baseline loses the takeout on a short-priced book", () => {
  const races = [];
  for (let i = 0; i < 12; i++) {
    const date = `2025-01-${String(i + 1).padStart(2, "0")}`;
    races.push({
      date,
      venue: "ST",
      race_no: 1,
      distance: 1200,
      runners: [
        { horse_no: 1, horse_code: "A001", jockey: "甲", draw: 2, finish_position: i % 4 === 0 ? "1" : "4", win_odds: 2.2 },
        { horse_no: 2, horse_code: "B002", jockey: "乙", draw: 8, finish_position: i % 4 === 1 ? "1" : "5", win_odds: 4 },
        { horse_no: 3, horse_code: "C003", jockey: "丙", draw: 10, finish_position: i % 4 === 2 ? "1" : "6", win_odds: 8 },
        { horse_no: 4, horse_code: "D004", jockey: "丁", draw: 12, finish_position: i % 4 === 3 ? "1" : "7", win_odds: 12 },
        { horse_no: 5, horse_code: "E005", jockey: "戊", draw: 3, finish_position: "8", win_odds: 20 },
        { horse_no: 6, horse_code: "F006", jockey: "己", draw: 5, finish_position: "2", win_odds: 15 },
        { horse_no: 7, horse_code: "G007", jockey: "庚", draw: 6, finish_position: "3", win_odds: 18 },
      ],
    });
  }
  const report = walkForward(races, { trainFraction: 0.7 });
  assert.ok(report.favourite_test.bets > 0);
  assert.ok(report.favourite_test.roi < 0);
});

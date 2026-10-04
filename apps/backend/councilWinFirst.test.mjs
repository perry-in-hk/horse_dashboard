import assert from "node:assert/strict";
import test from "node:test";
import { COUNCIL_AGENTS } from "./src/lib/ai/council/agents.js";
import {
  NO_PREOFF_QUOTE,
  buildPreOffOddsSummary,
  formatRunnerLine,
  shapeRunnersForPacket,
  trendLineForSnapshotCount,
} from "./src/lib/ai/councilPacket.js";

test("lead prompt requires exactly one WIN first, then other products", () => {
  const system = COUNCIL_AGENTS.bookie.system;
  const winAt = system.indexOf("恰好一注 WIN");
  const afterAt = system.indexOf("在這注 WIN 之後");
  assert.ok(winAt > 0);
  assert.ok(afterAt > winAt);
  assert.match(system, /騎師、檔位或場地/);
  assert.match(system, /未有臨場/);
  assert.match(system, /未有開跑前報價/);
  assert.match(system, /禁止用過往結算或賽果 win_odds/);
});

test("quant, historian, trend, and scout prompts keep the new rules", () => {
  assert.match(COUNCIL_AGENTS.quant.system, /未有開跑前報價/);
  assert.match(COUNCIL_AGENTS.quant.system, /不要用自編機率/);
  assert.match(COUNCIL_AGENTS.historian.system, /騎師、檔位/);
  assert.match(COUNCIL_AGENTS.historian.system, /同場地同途程/);
  assert.match(COUNCIL_AGENTS.historian.system, /過往結算賠率，不是今場開跑前價格/);
  assert.match(COUNCIL_AGENTS.trend.system, /少於兩筆/);
  assert.match(COUNCIL_AGENTS.trend.system, /未有臨場/);
  assert.match(COUNCIL_AGENTS.trend.system, /上一輪之後才發生/);
  assert.match(COUNCIL_AGENTS.scout.system, /騎師、檔位、場地/);
  assert.match(COUNCIL_AGENTS.scout.system, /不是最終裁決者/);
  assert.match(COUNCIL_AGENTS.kelly.system, /不提出自己的投注建議/);
  assert.equal(Object.hasOwn(COUNCIL_AGENTS, "news"), false);
});

test("fewer than two snapshots is exactly 未有臨場", () => {
  assert.equal(trendLineForSnapshotCount(0), "未有臨場");
  assert.equal(trendLineForSnapshotCount(1), "未有臨場");
  assert.equal(trendLineForSnapshotCount(2), "");
});

test("missing snapshot does not invent odds from settlement or racecard", () => {
  const post = Date.parse("2026-10-04T04:30:00.000Z");
  const empty = buildPreOffOddsSummary({
    snapshots: [],
    postTimeMs: post,
    resultWinOdds: { 1: 1.8, 2: 4.2 },
    racecardWin: { 1: 3.5, 2: 6 },
  });
  assert.equal(empty.note, NO_PREOFF_QUOTE);
  assert.equal(empty.source, "none");
  assert.deepEqual(empty.win, {});
  assert.deepEqual(empty.pla, {});

  const after = buildPreOffOddsSummary({
    snapshots: [
      {
        observed_at: "2026-10-04T05:00:00.000Z",
        payload: [{ oddsType: "WIN", oddsNodes: [{ combString: "1", oddsValue: "1.4" }, { combString: "2", oddsValue: "9" }] }],
      },
    ],
    postTimeMs: post,
    resultWinOdds: { 1: 1.4 },
  });
  assert.equal(after.note, NO_PREOFF_QUOTE);
  assert.deepEqual(after.win, {});
});

test("runner packet always includes jockey, draw, and venue keys", () => {
  const [blank] = shapeRunnersForPacket(
    [{ no: 4, horse_name: "金槍", horse_code: "K123" }],
    { venueCode: "ST", course: "沙田" }
  );
  assert.equal(blank.jockey, "");
  assert.equal(blank.draw, "");
  assert.equal(blank.venue, "ST");
  assert.equal(blank.course, "沙田");
  assert.equal(Object.hasOwn(blank, "jockey"), true);
  assert.equal(Object.hasOwn(blank, "draw"), true);
  assert.equal(Object.hasOwn(blank, "venue"), true);

  const line = formatRunnerLine(
    { no: 4, horse_name: "金槍", horse_code: "K123", jockey: "潘頓", draw: 3, venue: "ST", course: "沙田" },
    { win: "", pla: "" }
  );
  assert.match(line, /jockey=潘頓/);
  assert.match(line, /draw=3/);
  assert.match(line, /venue=ST/);
  assert.match(line, /course=沙田/);
  assert.match(line, /WIN\s+\|/);
});

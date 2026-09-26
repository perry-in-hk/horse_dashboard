import assert from "node:assert/strict";
import test from "node:test";
import { applyEdgeGate, applyResidual, impliedWinProbs, residualFromStats } from "./pricingCard.js";

test("implied probabilities sum to 1 after removing the overround", () => {
  const rows = impliedWinProbs({ 1: 1.8, 2: 1.8 });
  const sum = rows.reduce((acc, row) => acc + row.market_prob, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(1 / 1.8 > rows[0].market_prob);
});

test("residual is capped and a short-priced favourite without odds is dropped", () => {
  const market = impliedWinProbs({
    1: 2.3,
    2: 4,
    3: 6,
    4: 8,
    5: 12,
    6: 15,
    7: 20,
    8: 30,
  });
  const adj = {
    1: residualFromStats("1", {
      1: { cd_sample: 2, jockey_sample: 5, draw_sample: 4 },
    }),
  };
  assert.equal(adj[1].delta, 0);
  const pricing = applyResidual(market, { 1: { delta: 0.2 } });
  const favourite = pricing.find((row) => row.no === "1");
  assert.ok(favourite.model_prob - favourite.market_prob <= 0.04);
  const gated = applyEdgeGate(
    {
      summary_zh: "主推",
      summary_en: "primary",
      confidence: 0.7,
      data_freshness: "realtime",
      qpl: [{ combo: "1-2", odds: "", ev_status: "positive", reason_zh: "無賠率", reason_en: "no odds" }],
      others: [{ product: "WIN", combo: "1", odds: "2.3", ev_status: "positive", reason_zh: "熱門", reason_en: "fav" }],
    },
    pricing,
    12
  );
  assert.equal(gated.qpl.length, 0);
  assert.equal(gated.others.length, 1);
  assert.equal(gated.others[0].suggestion, true);
  assert.equal(gated.others[0].ev_status, "negative");
  assert.match(gated.others[0].reason_zh, /未達最佳/);
  assert.equal(gated.summary_zh, "本輪建議未達最佳");
});

test("a longshot above the odds cap is not released", () => {
  const gated = applyEdgeGate(
    {
      summary_zh: "冷門",
      summary_en: "longshot",
      confidence: 0.4,
      qpl: [],
      others: [{ product: "WIN", combo: "1", odds: "40", ev_status: "positive", reason_zh: "冷", reason_en: "long" }],
    },
    [{ no: "1", odds: 40, market_prob: 0.02, model_prob: 0.05, edge: 1 }],
    12
  );
  assert.equal(gated.others.length, 0);
  assert.equal(gated.summary_zh, "缺少可建議的賠率");
});

test("only the highest-edge win is released, and place or quinella keep one each", () => {
  const pricing = [
    { no: "1", odds: 3, market_prob: 0.3, model_prob: 0.4, edge: 0.2 },
    { no: "2", odds: 4, market_prob: 0.2, model_prob: 0.35, edge: 0.4 },
    { no: "3", odds: 8, market_prob: 0.1, model_prob: 0.08, edge: -0.36 },
  ];
  const gated = applyEdgeGate(
    {
      summary_zh: "多注",
      summary_en: "several",
      confidence: 0.6,
      qpl: [
        { combo: "1-2", odds: "8", ev_status: "positive", reason_zh: "甲", reason_en: "a" },
        { combo: "1-3", odds: "8", ev_status: "positive", reason_zh: "乙", reason_en: "b" },
      ],
      others: [
        { product: "WIN", combo: "1", odds: "3", ev_status: "positive", reason_zh: "一", reason_en: "one" },
        { product: "WIN", combo: "2", odds: "4", ev_status: "positive", reason_zh: "二", reason_en: "two" },
        { product: "PLA", combo: "1", odds: "2.2", ev_status: "positive", reason_zh: "位", reason_en: "pla" },
        { product: "QIN", combo: "1-2", odds: "6", ev_status: "positive", reason_zh: "連", reason_en: "qin" },
      ],
    },
    pricing,
    12
  );
  const wins = gated.others.filter((row) => row.product === "WIN");
  assert.equal(wins.length, 1);
  assert.equal(wins[0].combo, "2");
  assert.equal(wins[0].suggestion, false);
  assert.equal(gated.others.filter((row) => row.product === "PLA").length, 1);
  assert.equal(gated.others.filter((row) => row.product === "QIN").length, 1);
  assert.ok(gated.qpl.length <= 3);
});

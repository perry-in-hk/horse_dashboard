import test from "node:test";
import assert from "node:assert/strict";
import { COUNCIL_AGENTS } from "./agents.js";
import { buildAnalystTurnPrompt, buildBookieRoundPrompt } from "./orchestrator.js";

const context = {
  oddsMomentumBlock: [
    "### Odds momentum",
    "  - key 8,10: 92.00 → 78.00 (−15.2%, abs −14.00) [NEW, ~1 min ago]",
  ].join("\n"),
  pricing: [
    { no: "6", odds: 3 },
    { no: "9", odds: 7.8 },
  ],
};

test("an unnamed drop is injected before the chair task", () => {
  const prompt = buildAnalystTurnPrompt({
    context,
    transcript: [{ content: "維持 #10 與 #6" }],
    roundNo: 2,
    turnNo: 1,
    speakerCode: "trend",
    chairDirective: "只核對 1-6",
    chairRuling: "不再討論 #8",
  });
  assert.match(prompt, /## 尚未點名/);
  assert.match(prompt, /組合 8,10/);
  assert.match(prompt, /#9 獨贏 7\.8/);
  assert.match(prompt, /第一句先點名/);
  assert.doesNotMatch(prompt, /必須先完成/);
  assert.match(prompt, /仍須點名/);
  const nameAt = prompt.indexOf("## 尚未點名");
  const taskAt = prompt.indexOf("只核對 1-6");
  assert.ok(nameAt > taskAt);
});

test("naming the horses removes the list and restores the chair-first rule", () => {
  const prompt = buildAnalystTurnPrompt({
    context,
    transcript: [{ content: "#8 配 #10，#9 五福星獨贏 7.8" }],
    roundNo: 2,
    turnNo: 2,
    speakerCode: "scout",
    chairDirective: "只核對 1-6",
  });
  assert.doesNotMatch(prompt, /尚未點名/);
  assert.match(prompt, /必須先完成/);
});

test("the chair must name a gap and may not ban saying it", () => {
  const prompt = buildBookieRoundPrompt({
    context,
    transcript: [{ content: "維持 #6" }],
    roundNo: 2,
    validHorseNos: [3, 6, 8, 9, 10],
  });
  assert.match(prompt, /round_summary_zh 必須點名/);
  assert.match(prompt, /不可禁止點名/);
  assert.match(prompt, /組合 8,10/);
  assert.match(prompt, /未達最佳/);
});

test("a covered transcript tells the chair there is no leftover quote", () => {
  const prompt = buildBookieRoundPrompt({
    context,
    transcript: [{ content: "#8 配 #10，#9 已看過" }],
    roundNo: 3,
    validHorseNos: [6, 8, 9, 10],
  });
  assert.match(prompt, /沒有遺漏的賠率變動/);
  assert.doesNotMatch(prompt, /## 尚未點名/);
});

test("agent rules keep one sentence for the unnamed list", () => {
  assert.match(COUNCIL_AGENTS.quant.system, /尚未點名/);
  assert.match(COUNCIL_AGENTS.trend.system, /無效資金/);
  assert.match(COUNCIL_AGENTS.scout.system, /尚未點名/);
  assert.match(COUNCIL_AGENTS.bookie.system, /不可禁止成員點名/);
  assert.match(COUNCIL_AGENTS.bookie.system, /未達最佳/);
});

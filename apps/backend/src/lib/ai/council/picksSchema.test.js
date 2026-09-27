import assert from "node:assert/strict";
import test from "node:test";
import { parseCouncilPicks } from "./picksSchema.js";

test("an empty slip stays empty and is not marked positive EV", () => {
  const parsed = parseCouncilPicks(
    { summary_zh: "先等等", summary_en: "wait", qpl: [], others: [], confidence: 0.8 },
    [1, 2, 3, 4]
  );
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.qpl.length, 0);
  assert.equal(parsed.data.others.length, 0);
  assert.equal(parsed.data.summary_zh, "本輪無正期望值");
  assert.equal(parsed.data.confidence, 0.8);
});

test("invalid horse numbers are dropped instead of replaced", () => {
  const parsed = parseCouncilPicks(
    {
      summary_zh: "有一注",
      summary_en: "one bet",
      qpl: [{ combo: "99-98", odds: "12", ev_status: "positive", reason_zh: "不在場", reason_en: "absent" }],
      others: [{ product: "WIN", combo: "3", odds: "4.2", ev_status: "positive", reason_zh: "#3", reason_en: "#3" }],
    },
    [1, 2, 3, 4]
  );
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.qpl.length, 0);
  assert.equal(parsed.data.others.length, 1);
  assert.equal(parsed.data.others[0].combo, "3");
  assert.equal(parsed.data.others[0].product, "WIN");
});

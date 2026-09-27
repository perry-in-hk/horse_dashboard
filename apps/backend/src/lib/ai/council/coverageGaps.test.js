import test from "node:test";
import assert from "node:assert/strict";
import { formatCoverageBlock, listCoverageGaps } from "./coverageGaps.js";

const momentum = [
  "### Odds momentum",
  "  - key 8,10: 92.00 → 78.00 (−15.2%, abs −14.00) between 12:43:00 HKT and 12:44:00 HKT [NEW, ~1 min ago]",
  "  - key 6: 3.20 → 2.90 (−9.4%, abs −0.30) between 12:43:00 HKT and 12:44:00 HKT [OLD, ~8 min ago — do not re-report]",
  "  - key 3: 8.00 → 6.20 (−22.5%, abs −1.80) between 12:43:00 HKT and 12:44:00 HKT [NEW, ~0 min ago]",
].join("\n");

test("a new pair drop stays on the list until every leg has been named", () => {
  const gaps = listCoverageGaps(
    {
      oddsMomentumBlock: momentum,
      pricing: [
        { no: "6", odds: 3 },
        { no: "9", odds: 7.8 },
        { no: "8", odds: 35 },
      ],
    },
    [{ content: "維持 #10 VON BAER 與 #6 銳一" }]
  );
  assert.ok(gaps.some((line) => line.includes("8,10")));
  assert.ok(gaps.some((line) => line.startsWith("#9")));
  assert.equal(gaps.some((line) => line.startsWith("#8")), false);
  assert.equal(gaps.some((line) => line.startsWith("#6")), false);
});

test("naming both legs removes the pair, and an empty list formats to nothing", () => {
  const context = {
    oddsMomentumBlock: momentum,
    pricing: [{ no: "9", odds: 7.8 }],
  };
  const transcript = [{ content: "#8 配 #10，另外 #3 與 #9 五福星已看過" }];
  assert.equal(listCoverageGaps(context, transcript).some((line) => line.includes("8,10")), false);
  assert.equal(listCoverageGaps(context, transcript).some((line) => line.startsWith("#9")), false);
  assert.equal(formatCoverageBlock({ oddsMomentumBlock: "", pricing: [] }, transcript), "");
});

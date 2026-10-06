import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_MEETING_PICK,
  NOT_MENTIONED,
  commentsForHorse,
  followOnLines,
  horseNameView,
  listRoundNumbers,
  messageMentionsHorse,
  winSuggestion,
} from "./src/lib/councilPickDisplay.js";

test("WIN suggestion is the single win horse, and follow-ons are only PLA QIN QPL", () => {
  const picks = {
    others: [
      { product: "WIN", combo: "4", odds: "", reason_zh: "潘頓，檔位 3，沙田。未有臨場" },
      { product: "PLA", combo: "4", reason_zh: "位置" },
      { product: "FCT", combo: "4-7", reason_zh: "不應跟在獨贏行後面當位置Q" },
    ],
    qpl: [{ combo: "4-7", reason_zh: "位置Q" }],
  };
  const win = winSuggestion(picks);
  assert.equal(win.horseNo, 4);
  assert.match(win.reason, /潘頓/);
  const follow = followOnLines(picks).map((row) => row.product);
  assert.deepEqual(follow, ["PLA", "QPL"]);
  assert.equal(NO_MEETING_PICK, "未有建議，未開會");
});

test("no persisted win pick is not invented", () => {
  assert.equal(winSuggestion(null), null);
  assert.equal(winSuggestion({ qpl: [{ combo: "1-2", reason_zh: "只有Q" }], others: [] }), null);
});

test("horse cards quote only tied mentions and otherwise stay empty", () => {
  assert.equal(messageMentionsHorse("14號大熱", 4), false);
  assert.equal(messageMentionsHorse("#4 潘頓檔位好", 4), true);
  const messages = [
    { role: "agent", meta_json: { speaker: "historian" }, content: "#4 同場地同途程有優勢。" },
    { role: "agent", meta_json: { speaker: "quant" }, content: "#8 機率一般。" },
  ];
  const picks = {
    others: [{ product: "WIN", combo: "4", reason_zh: "建議 #4，騎師潘頓。" }],
    qpl: [],
  };
  const four = commentsForHorse(4, { messages, picks });
  assert.ok(four.some((quote) => quote.kind === "pick" && quote.text.includes("潘頓")));
  assert.ok(four.some((quote) => quote.kind === "transcript" && quote.text.includes("同場地")));
  assert.equal(commentsForHorse(2, { messages, picks }).length, 0);
  assert.equal(NOT_MENTIONED, "未提過");
});

test("horse cards follow the selected round and color the name by view", () => {
  const messages = [
    { role: "agent", meta_json: { speaker: "historian", round_no: 1 }, content: "#4 升權，同場地有優勢。" },
    { role: "agent", meta_json: { speaker: "scout", round_no: 1 }, content: "#8 剔除，過熱。" },
    { role: "agent", meta_json: { speaker: "historian", round_no: 2 }, content: "#4 降權，陷阱。" },
  ];
  assert.deepEqual(listRoundNumbers(messages), [1, 2]);
  const round1 = commentsForHorse(4, { messages, roundNo: 1 });
  const round2 = commentsForHorse(4, { messages, roundNo: 2 });
  assert.equal(horseNameView(round1), "positive");
  assert.equal(horseNameView(round2), "negative");
  assert.equal(horseNameView(commentsForHorse(2, { messages, roundNo: 1 })), "none");
  assert.equal(horseNameView(commentsForHorse(8, { messages, roundNo: 1 })), "negative");
  assert.equal(commentsForHorse(4, { messages, roundNo: 1 }).some((quote) => quote.text.includes("降權")), false);
});

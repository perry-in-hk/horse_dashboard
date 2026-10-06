import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_MEETING_PICK,
  NOT_MENTIONED,
  commentsForHorse,
  followOnLines,
  horseNameView,
  horseNoteFor,
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

test("horse card uses the selected round summary instead of the quote list", () => {
  const messages = [
    {
      role: "agent",
      meta_json: {
        speaker: "bookie",
        round_no: 1,
        horse_notes: [
          { horse_no: 4, summary_zh: "第一輪看好。", buy_zh: "獨贏", stake_zh: "建議 0.4 注", view: "positive" },
        ],
      },
    },
    {
      role: "agent",
      meta_json: {
        speaker: "bookie",
        round_no: 2,
        horse_notes: [
          { horse_no: 4, summary_zh: "第二輪差價不夠。", buy_zh: "獨贏", stake_zh: "低信心，不落注", view: "none" },
        ],
      },
    },
  ];
  const first = horseNoteFor(4, { messages, roundNo: 1 });
  const second = horseNoteFor(4, { messages, roundNo: 2 });
  assert.equal(first.summary_zh, "第一輪看好。");
  assert.equal(first.stake_zh, "建議 0.4 注");
  assert.equal(second.stake_zh, "低信心，不落注");
  assert.equal(horseNoteFor(8, { messages, roundNo: 1 }), null);
});

test("a round without saved notes still summarizes the horse and names a bet", () => {
  const messages = [
    {
      role: "agent",
      meta_json: { speaker: "quant", round_no: 7 },
      content: "QPL 04-09 @5.0 市場機會 16.5%，差價 +2.6 個百分點。#4 升水就係條線 edge 消失。",
    },
    {
      role: "agent",
      meta_json: { speaker: "trend", round_no: 7 },
      content: "#11 WIN 14.0 距翻案線 10.0 仍差 4.0 格，短期內唔會成立。",
    },
    {
      role: "agent",
      meta_json: { speaker: "bookie", round_no: 7, horse_notes: [] },
      content: "暫無最終結論",
    },
  ];
  const four = horseNoteFor(4, { messages, roundNo: 7 });
  assert.match(four.summary_zh, /QPL 04-09/);
  assert.equal(four.buy_zh, "位置Q 4-9");
  assert.equal(four.stake_zh, "低信心，不落注");
  const eleven = horseNoteFor(11, { messages, roundNo: 7 });
  assert.match(eleven.summary_zh, /#11 WIN/);
  assert.equal(eleven.buy_zh, "獨贏");
  assert.equal(eleven.stake_zh, "低信心，不落注");
  assert.equal(horseNoteFor(2, { messages, roundNo: 7 }), null);
});

test("a saved note that refuses a buy still names the pool discussed", () => {
  const messages = [
    {
      role: "agent",
      meta_json: {
        speaker: "bookie",
        round_no: 8,
        horse_notes: [
          { horse_no: 11, summary_zh: "距翻案線仍遠。", buy_zh: "本輪沒有建議買這匹", stake_zh: "低信心，不落注", view: "negative" },
        ],
      },
    },
    {
      role: "agent",
      meta_json: { speaker: "trend", round_no: 8 },
      content: "#11 WIN 14.0 距翻案線 10.0 仍差 4.0 格。",
    },
  ];
  const note = horseNoteFor(11, { messages, roundNo: 8 });
  assert.equal(note.summary_zh, "距翻案線仍遠。");
  assert.equal(note.buy_zh, "獨贏");
  assert.equal(note.stake_zh, "低信心，不落注");
});

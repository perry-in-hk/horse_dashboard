import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_PREOFF_QUOTE,
  boardPricesFromSnapshots,
  parseWinQuotes,
  pickFavouriteAndSecond,
  summarizeHorseForm,
} from "./src/lib/aiBoard.js";

const post = Date.parse("2026-10-04T04:30:00.000Z");

test("favourite is the lowest win odds and second is the next lowest", () => {
  const payload = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "5.2" },
        { combString: "4", oddsValue: "2.0" },
        { combString: "7", oddsValue: "3.1" },
        { combString: "9", oddsValue: "12" },
      ],
    },
  ];
  const result = boardPricesFromSnapshots(
    [{ observed_at: "2026-10-04T03:00:00.000Z", payload }],
    post
  );
  assert.equal(result.label, null);
  assert.equal(result.mode, "before-post");
  assert.deepEqual(result.favourite, { horseNo: 4, odds: 2 });
  assert.deepEqual(result.second, { horseNo: 7, odds: 3.1 });
});

test("equal lowest odds: smaller horse number is the favourite", () => {
  const pair = pickFavouriteAndSecond([
    { horseNo: 8, odds: 2.5 },
    { horseNo: 2, odds: 2.5 },
    { horseNo: 3, odds: 9 },
  ]);
  assert.ok(pair);
  assert.equal(pair.favourite.horseNo, 2);
  assert.equal(pair.second.horseNo, 8);
});

test("no snapshot shows 未有開跑前報價 and ignores result-page win odds", () => {
  const resultPage = [
    { horse_no: 1, win_odds: 1.8 },
    { horse_no: 2, win_odds: 4.2 },
  ];
  const result = boardPricesFromSnapshots([], post, resultPage);
  assert.equal(result.label, NO_PREOFF_QUOTE);
  assert.equal(result.favourite, null);
  assert.equal(result.second, null);
});

test("snapshots taken at or after post time are not pre-off prices", () => {
  const payload = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "1.8" },
        { combString: "2", oddsValue: "4.0" },
      ],
    },
  ];
  const atPost = boardPricesFromSnapshots(
    [{ observed_at: "2026-10-04T04:30:00.000Z", payload }],
    post,
    [{ horse_no: 1, win_odds: 1.8 }]
  );
  const after = boardPricesFromSnapshots(
    [{ observed_at: "2026-10-04T04:40:00.000Z", payload }],
    post
  );
  assert.equal(atPost.label, NO_PREOFF_QUOTE);
  assert.equal(atPost.favourite, null);
  assert.equal(after.label, NO_PREOFF_QUOTE);
});

test("latest snapshot before post time wins over an earlier one", () => {
  const early = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "9" },
        { combString: "2", oddsValue: "8" },
      ],
    },
  ];
  const late = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "2.2" },
        { combString: "2", oddsValue: "6.5" },
      ],
    },
  ];
  const after = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "1.4" },
        { combString: "2", oddsValue: "20" },
      ],
    },
  ];
  const result = boardPricesFromSnapshots(
    [
      { observed_at: "2026-10-04T02:00:00.000Z", payload: early },
      { observed_at: "2026-10-04T04:00:00.000Z", payload: late },
      { observed_at: "2026-10-04T05:00:00.000Z", payload: after },
    ],
    post
  );
  assert.deepEqual(result.favourite, { horseNo: 1, odds: 2.2 });
  assert.deepEqual(result.second, { horseNo: 2, odds: 6.5 });
});

test("when post time is unknown, the latest stored snapshot is used", () => {
  const early = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "9" },
        { combString: "2", oddsValue: "8" },
      ],
    },
  ];
  const late = [
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "3", oddsValue: "4.4" },
        { combString: "5", oddsValue: "1.9" },
      ],
    },
  ];
  const result = boardPricesFromSnapshots(
    [
      { observed_at: "2026-10-04T01:00:00.000Z", payload: early },
      { observed_at: "2026-10-04T06:00:00.000Z", payload: late },
    ],
    null
  );
  assert.equal(result.mode, "latest");
  assert.equal(result.favourite.horseNo, 5);
  assert.equal(result.second.horseNo, 3);
});

test("SCR, place pool, and a single win quote do not invent a pair", () => {
  const quotes = parseWinQuotes([
    {
      oddsType: "PLA",
      oddsNodes: [
        { combString: "1", oddsValue: "1.1" },
        { combString: "2", oddsValue: "1.2" },
      ],
    },
    {
      oddsType: "WIN",
      oddsNodes: [
        { combString: "1", oddsValue: "SCR" },
        { combString: "2", oddsValue: "4.5" },
      ],
    },
  ]);
  assert.equal(pickFavouriteAndSecond(quotes), null);
  const result = boardPricesFromSnapshots(
    [{ observed_at: "2026-10-04T03:00:00.000Z", payload: [
      { oddsType: "WIN", oddsNodes: [{ combString: "2", oddsValue: "4.5" }] },
    ] }],
    post
  );
  assert.equal(result.label, NO_PREOFF_QUOTE);
});

test("same-venue same-distance uses history only and says when it cannot", () => {
  const rows = [
    { race_date: "2026-09-01", racecourse: "ST", race_no: 1, race_distance: 1200, finish_position: "1", draw: 4 },
    { race_date: "2026-09-14", racecourse: "HV", race_no: 2, race_distance: 1200, finish_position: "3", draw: 8 },
    { race_date: "2026-09-21", racecourse: "ST", race_no: 3, race_distance: 1650, finish_position: "2", draw: 2 },
    { race_date: "2026-10-04", racecourse: "ST", race_no: 1, race_distance: 1200, finish_position: "5", draw: 6 },
  ];
  const form = summarizeHorseForm(rows, {
    venueCode: "ST",
    meetingDate: "2026-10-04",
    raceNo: 1,
    distance: 1200,
    draw: 6,
  });
  assert.equal(form.sameVenueDistance, "1200米 · 1戰1冠1次前三");
  assert.equal(form.recent, "2/3/1");
  assert.equal(form.draw, "今場 6 檔");

  const missing = summarizeHorseForm(
    [{ race_date: "2026-09-01", racecourse: "ST", race_no: 1, finish_position: "1" }],
    { venueCode: "ST", meetingDate: "2026-10-04", raceNo: 4, distance: null, draw: null }
  );
  assert.equal(missing.sameVenueDistance, "無法計算：沒有今場途程");
  assert.equal(missing.draw, "無法計算今場檔位");
});

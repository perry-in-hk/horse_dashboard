/**
 * Walk-forward scoring for the council pricing card.
 * Features for a race are built only from earlier meetings.
 */

import { applyResidual, EDGE_MIN, edgeForPick, impliedWinProbs, residualFromStats } from "./pricingCard.js";

function addDays(iso, days) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function posInt(raw) {
  const m = String(raw ?? "").trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createHistory() {
  return {
    cd: new Map(),
    jockeyRuns: [],
    draw: new Map(),
    drawAll: new Map(),
  };
}

function bump(map, key, top3) {
  const row = map.get(key) ?? { n: 0, top3: 0 };
  row.n += 1;
  if (top3) row.top3 += 1;
  map.set(key, row);
}

export function statsForRunner(history, runner, race) {
  const cd = history.cd.get(`${runner.horse_code}|${race.venue}|${race.distance}`) ?? { n: 0, top3: 0 };
  const cutoff = addDays(race.date, -120);
  let jockeySample = 0;
  let jockeyWins = 0;
  for (let i = history.jockeyRuns.length - 1; i >= 0; i--) {
    const row = history.jockeyRuns[i];
    if (row.date < cutoff) break;
    if (row.jockey !== runner.jockey) continue;
    jockeySample += 1;
    if (row.win) jockeyWins += 1;
  }
  const bucket = runner.draw == null ? "unknown" : runner.draw <= 4 ? "inside" : runner.draw <= 8 ? "middle" : "wide";
  const draw = history.draw.get(`${race.venue}|${race.distance}|${bucket}`) ?? { n: 0, top3: 0 };
  const base = history.drawAll.get(`${race.venue}|${race.distance}`) ?? { n: 0, top3: 0 };
  return {
    cd_sample: cd.n,
    cd_top3_rate: cd.n ? cd.top3 / cd.n : null,
    jockey_sample: jockeySample,
    jockey_win_rate: jockeySample ? jockeyWins / jockeySample : null,
    draw_sample: draw.n,
    draw_top3_rate: draw.n ? draw.top3 / draw.n : null,
    draw_base_rate: base.n ? base.top3 / base.n : null,
  };
}

export function commitRace(history, race) {
  const date = race.date;
  for (const runner of race.runners) {
    const pos = posInt(runner.finish_position);
    const top3 = pos != null && pos <= 3;
    if (runner.horse_code && race.distance) {
      bump(history.cd, `${runner.horse_code}|${race.venue}|${race.distance}`, top3);
    }
    if (runner.jockey) {
      history.jockeyRuns.push({ date, jockey: runner.jockey, win: pos === 1 });
    }
    if (race.distance && runner.draw != null) {
      const bucket = runner.draw <= 4 ? "inside" : runner.draw <= 8 ? "middle" : "wide";
      bump(history.draw, `${race.venue}|${race.distance}|${bucket}`, top3);
      bump(history.drawAll, `${race.venue}|${race.distance}`, top3);
    }
  }
  const cutoff = addDays(date, -130);
  if (history.jockeyRuns.length > 4000 && history.jockeyRuns[0].date < cutoff) {
    history.jockeyRuns = history.jockeyRuns.filter((row) => row.date >= cutoff);
  }
}

function featureVector(stats) {
  return [
    stats.cd_sample >= 8 && stats.cd_top3_rate != null ? stats.cd_top3_rate - 0.25 : 0,
    stats.jockey_sample >= 20 && stats.jockey_win_rate != null ? stats.jockey_win_rate - 0.1 : 0,
    stats.draw_sample >= 30 && stats.draw_top3_rate != null && stats.draw_base_rate != null
      ? stats.draw_top3_rate - stats.draw_base_rate
      : 0,
  ];
}

function logit(p) {
  const x = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(x / (1 - x));
}

function sigmoid(z) {
  const x = Math.max(-20, Math.min(20, z));
  return 1 / (1 + Math.exp(-x));
}

export function fitResidual(rows) {
  const b = [0, 0, 0];
  if (!rows.length) return b;
  const lr = 0.15;
  const l2 = 1;
  for (let epoch = 0; epoch < 60; epoch++) {
    const g = [0, 0, 0];
    for (const row of rows) {
      const z = row.logit + b[0] * row.f[0] + b[1] * row.f[1] + b[2] * row.f[2];
      const err = sigmoid(z) - row.y;
      g[0] += err * row.f[0];
      g[1] += err * row.f[1];
      g[2] += err * row.f[2];
    }
    const n = rows.length;
    b[0] -= lr * (g[0] / n + l2 * b[0]);
    b[1] -= lr * (g[1] / n + l2 * b[1]);
    b[2] -= lr * (g[2] / n + l2 * b[2]);
  }
  return b.map((x) => Math.round(x * 1000) / 1000);
}

function priceRace(race, history, mode, coefficients) {
  const winOdds = {};
  for (const runner of race.runners) {
    if (runner.horse_no && Number(runner.win_odds) > 1) winOdds[String(runner.horse_no)] = Number(runner.win_odds);
  }
  const market = impliedWinProbs(winOdds);
  const byNo = new Map(market.map((row) => [row.no, row]));
  const prepared = [];
  for (const runner of race.runners) {
    const quote = byNo.get(String(runner.horse_no));
    if (!quote) continue;
    const stats = statsForRunner(history, runner, race);
    prepared.push({ runner, quote, stats, f: featureVector(stats) });
  }
  let pricing;
  if (mode === "shipped") {
    const adjustments = {};
    for (const row of prepared) adjustments[String(row.runner.horse_no)] = residualFromStats(row.runner.horse_no, { [String(row.runner.horse_no)]: row.stats });
    pricing = applyResidual(market, adjustments);
  } else {
    const adjustments = {};
    for (const row of prepared) {
      const z = logit(row.quote.market_prob) + coefficients[0] * row.f[0] + coefficients[1] * row.f[1] + coefficients[2] * row.f[2];
      const shifted = sigmoid(z) - row.quote.market_prob;
      adjustments[row.quote.no] = { delta: shifted };
    }
    pricing = applyResidual(market, adjustments);
  }
  const priced = new Map(pricing.map((row) => [row.no, row]));
  const bets = [];
  const trainRows = [];
  for (const row of prepared) {
    const model = priced.get(String(row.runner.horse_no));
    const pos = posInt(row.runner.finish_position);
    const won = pos === 1;
    trainRows.push({ logit: logit(row.quote.market_prob), f: row.f, y: won ? 1 : 0 });
    if (!model || model.edge < EDGE_MIN) continue;
    const capped = edgeForPick("WIN", String(row.runner.horse_no), model.odds, pricing, race.runners.length);
    bets.push({
      capped: Boolean(capped.ok),
      date: race.date,
      venue: race.venue,
      race_no: race.race_no,
      horse_no: row.runner.horse_no,
      odds: model.odds,
      edge: model.edge,
      hit: won,
      unit_return: won ? Math.round((model.odds - 1) * 1000) / 1000 : -1,
    });
  }
  const favourite = [...prepared].sort((a, b) => a.quote.odds - b.quote.odds)[0];
  const favBet = favourite
    ? {
        hit: posInt(favourite.runner.finish_position) === 1,
        unit_return: posInt(favourite.runner.finish_position) === 1 ? favourite.quote.odds - 1 : -1,
        odds: favourite.quote.odds,
      }
    : null;
  return { bets, trainRows, favBet };
}

export function summarizeBets(bets) {
  const n = bets.length;
  const hits = bets.filter((b) => b.hit).length;
  const sum = bets.reduce((acc, b) => acc + b.unit_return, 0);
  const avgOdds = n ? bets.reduce((acc, b) => acc + b.odds, 0) / n : null;
  return {
    bets: n,
    hits,
    hit_pct: n ? Math.round((1000 * hits) / n) / 10 : null,
    unit_return_sum: Math.round(sum * 1000) / 1000,
    roi: n ? Math.round((1000 * sum) / n) / 1000 : null,
    avg_odds: avgOdds == null ? null : Math.round(avgOdds * 100) / 100,
  };
}

export function walkForward(races, { trainFraction = 0.7 } = {}) {
  const ordered = [...races].sort((a, b) =>
    a.date === b.date ? a.venue === b.venue ? a.race_no - b.race_no : a.venue.localeCompare(b.venue) : a.date.localeCompare(b.date)
  );
  const dates = [...new Set(ordered.map((r) => r.date))];
  const cut = dates[Math.max(0, Math.floor(dates.length * trainFraction) - 1)] ?? dates[0];
  const history = createHistory();
  const trainExamples = [];
  const shippedTrain = [];
  const shippedTest = [];
  const favTest = [];
  for (const date of dates) {
    const day = ordered.filter((race) => race.date === date);
    for (const race of day) {
      const scored = priceRace(race, history, "shipped");
      if (date <= cut) {
        shippedTrain.push(...scored.bets);
        trainExamples.push(...scored.trainRows);
      } else {
        shippedTest.push(...scored.bets);
        if (scored.favBet) favTest.push(scored.favBet);
      }
    }
    for (const race of day) commitRace(history, race);
  }
  const coefficients = fitResidual(trainExamples.filter((row) => row.f.some((x) => x !== 0)));
  const history2 = createHistory();
  const trainedTest = [];
  for (const date of dates) {
    const day = ordered.filter((race) => race.date === date);
    if (date > cut) {
      for (const race of day) trainedTest.push(...priceRace(race, history2, "trained", coefficients).bets);
    }
    for (const race of day) commitRace(history2, race);
  }
  return {
    train_through: cut,
    test_from: dates.find((d) => d > cut) ?? null,
    meetings: dates.length,
    races: ordered.length,
    coefficients,
    shipped_train: summarizeBets(shippedTrain),
    shipped_train_bets: shippedTrain,
    shipped_test: summarizeBets(shippedTest),
    capped_train: summarizeBets(shippedTrain.filter((bet) => bet.capped)),
    capped_test: summarizeBets(shippedTest.filter((bet) => bet.capped)),
    trained_test: summarizeBets(trainedTest),
    favourite_test: summarizeBets(favTest.map((b) => ({ ...b, edge: 0 }))),
    shipped_test_bets: shippedTest,
  };
}

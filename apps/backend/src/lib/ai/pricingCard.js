/**
 * Market-implied win probabilities plus a small, capped residual.
 * A bet is releasable only when model probability times the offered odds exceeds 1 by the edge floor.
 */

export const EDGE_MIN = Number(process.env.COUNCIL_EDGE_MIN ?? 0.02);
// Walk-forward on local results through 2026-01-07: residual weights fit to 0,
// and every wider odds band lost money. Above this price the ±0.03 cap alone
// manufactures a positive edge. Default 12. Set COUNCIL_MAX_BET_ODDS=0 to disable.
export const MAX_BET_ODDS = Number(process.env.COUNCIL_MAX_BET_ODDS ?? 12);
const ADJUST_CAP = 0.03;

export function impliedWinProbs(winOdds) {
  const entries = Object.entries(winOdds ?? {})
    .map(([no, odds]) => ({ no: String(no), odds: Number(odds) }))
    .filter((row) => Number.isFinite(row.odds) && row.odds > 1);
  const raw = entries.map((row) => ({ ...row, implied: 1 / row.odds }));
  const sum = raw.reduce((acc, row) => acc + row.implied, 0);
  if (!(sum > 0)) return [];
  return raw.map((row) => ({
    no: row.no,
    odds: row.odds,
    market_prob: row.implied / sum,
    implied: row.implied,
  }));
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {Array<{ no: string, odds: number, market_prob: number }>} market
 * @param {Record<string, { delta?: number }>} adjustments keyed by horse number
 */
export function applyResidual(market, adjustments) {
  const shifted = market.map((row) => {
    const delta = Number(adjustments?.[row.no]?.delta ?? 0);
    return { ...row, model_prob: Math.max(0.005, row.market_prob + clamp(delta, -ADJUST_CAP, ADJUST_CAP)) };
  });
  const sum = shifted.reduce((acc, row) => acc + row.model_prob, 0) || 1;
  return shifted.map((row) => {
    const model = row.model_prob / sum;
    const edge = model * row.odds - 1;
    return {
      no: row.no,
      odds: row.odds,
      market_prob: Math.round(row.market_prob * 10000) / 10000,
      model_prob: Math.round(model * 10000) / 10000,
      edge: Math.round(edge * 10000) / 10000,
    };
  });
}

export function residualFromStats(horseNo, stats) {
  const row = stats?.[String(horseNo)] ?? {};
  let delta = 0;
  const notes = [];
  if (row.cd_sample >= 8 && row.cd_top3_rate != null) {
    const cd = clamp((Number(row.cd_top3_rate) - 0.25) * 0.08, -0.015, 0.015);
    delta += cd;
    notes.push(`同途程上名率 ${Math.round(row.cd_top3_rate * 100)}%（n=${row.cd_sample}）`);
  } else {
    notes.push("同途程上名率：樣本不足");
  }
  if (row.jockey_sample >= 20 && row.jockey_win_rate != null) {
    const j = clamp((Number(row.jockey_win_rate) - 0.1) * 0.08, -0.015, 0.015);
    delta += j;
    notes.push(`騎師近期勝出率 ${Math.round(row.jockey_win_rate * 100)}%（n=${row.jockey_sample}）`);
  } else {
    notes.push("騎師近期勝出率：樣本不足");
  }
  if (row.draw_sample >= 30 && row.draw_top3_rate != null && row.draw_base_rate != null) {
    const d = clamp((Number(row.draw_top3_rate) - Number(row.draw_base_rate)) * 0.1, -0.015, 0.015);
    delta += d;
    notes.push(`檔位分桶上名率 ${Math.round(row.draw_top3_rate * 100)}%`);
  } else {
    notes.push("檔位分桶：樣本不足");
  }
  return { delta: clamp(delta, -ADJUST_CAP, ADJUST_CAP), notes };
}

function legsOf(combo) {
  return String(combo ?? "")
    .match(/\d+/g)
    ?.map((x) => String(Number.parseInt(x, 10)))
    .filter((x) => x !== "NaN") ?? [];
}

function byNo(pricing) {
  return new Map((pricing ?? []).map((row) => [String(row.no), row]));
}

/** Rough probability a horse finishes in the place slots, given normalized win probability. */
export function placeProb(winProb, fieldSize, slots) {
  const p = Number(winProb);
  const n = Number(fieldSize);
  const k = Number(slots);
  if (!(p > 0) || !(n > 1) || !(k > 0)) return 0;
  if (n <= k) return Math.min(0.95, p);
  const residual = ((k - 1) * (1 - p)) / (n - 1);
  return Math.min(0.95, p + residual);
}

function comboProb(product, legs, map, fieldSize) {
  const rows = legs.map((no) => map.get(String(no))).filter(Boolean);
  if (rows.length !== legs.length) return null;
  const slots = fieldSize >= 7 ? 3 : fieldSize >= 4 ? 2 : 0;
  if (product === "WIN") return rows[0].model_prob;
  if (product === "PLA") return slots ? placeProb(rows[0].model_prob, fieldSize, slots) : null;
  if (product === "QIN" || product === "QPL") {
    const [a, b] = rows;
    if (product === "QIN") {
      const pij = a.model_prob * (b.model_prob / Math.max(0.05, 1 - a.model_prob));
      const pji = b.model_prob * (a.model_prob / Math.max(0.05, 1 - b.model_prob));
      return Math.min(0.95, pij + pji);
    }
    const pa = placeProb(a.model_prob, fieldSize, 3);
    const pb = placeProb(b.model_prob, fieldSize, 3);
    return Math.min(pa, pb, pa * pb * 1.15);
  }
  if (product === "FCT" && rows.length === 2) {
    const [a, b] = rows;
    return a.model_prob * (b.model_prob / Math.max(0.05, 1 - a.model_prob));
  }
  return null;
}

export function edgeForPick(product, combo, odds, pricing, fieldSize) {
  const price = Number(String(odds ?? "").replace(/,/g, ""));
  if (!(price > 1)) return { ok: false, reason: "no_odds" };
  if (MAX_BET_ODDS > 0 && price > MAX_BET_ODDS) return { ok: false, reason: "odds_cap" };
  const legs = legsOf(combo);
  const prob = comboProb(String(product || "").toUpperCase(), legs, byNo(pricing), fieldSize);
  if (prob == null) return { ok: false, reason: "no_model" };
  const edge = prob * price - 1;
  return { ok: edge >= EDGE_MIN, edge, prob, reason: edge >= EDGE_MIN ? "edge" : "below_threshold" };
}

function annotatePick(row, product, pricing, fieldSize) {
  const judged = edgeForPick(product, row?.combo, row?.odds, pricing, fieldSize);
  return { row, product, judged };
}

function asReleased(item) {
  return {
    ...item.row,
    product: item.product,
    suggestion: false,
    ev_status: "positive",
    reason_zh: `${item.row.reason_zh}（edge ${item.judged.edge.toFixed(3)}）`,
    reason_en: `${item.row.reason_en} (edge ${item.judged.edge.toFixed(3)})`,
  };
}

function topReleased(items, limit) {
  return items
    .filter((item) => item.judged.ok)
    .sort((a, b) => b.judged.edge - a.judged.edge)
    .slice(0, limit)
    .map(asReleased);
}

function comboKey(combo) {
  return legsOf(combo).slice().sort((a, b) => Number(a) - Number(b)).join("-");
}

/** Highest-edge win quote at or under the odds cap. Edge may be negative. Not a released bet. */
export function suggestWin(pricing) {
  const rows = (pricing ?? []).filter((row) => {
    const odds = Number(row?.odds);
    if (!(odds > 1)) return false;
    if (MAX_BET_ODDS > 0 && odds > MAX_BET_ODDS) return false;
    return Number.isFinite(Number(row?.edge));
  });
  rows.sort((a, b) => b.edge - a.edge || a.odds - b.odds);
  const best = rows[0];
  if (!best) return null;
  const edge = Number(best.edge).toFixed(3);
  return {
    product: "WIN",
    combo: String(best.no),
    odds: String(best.odds),
    suggestion: true,
    ev_status: "negative",
    reason_zh: `未達最佳（edge ${edge}）`,
    reason_en: `Not the best situation (edge ${edge})`,
  };
}

export function applyEdgeGate(picks, pricing, fieldSize) {
  const src = picks && typeof picks === "object" ? picks : {};
  const qplItems = [];
  const seenQpl = new Set();
  for (const row of Array.isArray(src.qpl) ? src.qpl : []) {
    const key = comboKey(row?.combo);
    if (!key || seenQpl.has(key)) continue;
    seenQpl.add(key);
    qplItems.push(annotatePick(row, "QPL", pricing, fieldSize));
  }
  const byProduct = { WIN: [], PLA: [], QIN: [] };
  for (const row of Array.isArray(src.others) ? src.others : []) {
    const product = String(row?.product || "WIN").toUpperCase();
    if (product === "QPL") {
      const key = comboKey(row?.combo);
      if (!key || seenQpl.has(key)) continue;
      seenQpl.add(key);
      qplItems.push(annotatePick(row, "QPL", pricing, fieldSize));
      continue;
    }
    if (!byProduct[product]) continue;
    byProduct[product].push(annotatePick(row, product, pricing, fieldSize));
  }
  const qpl = topReleased(qplItems, 3).map(({ product, ...row }) => row);
  const others = ["WIN", "PLA", "QIN"].flatMap((product) => topReleased(byProduct[product], 1));
  if (qpl.length || others.length) {
    return { ...src, qpl, others };
  }
  const suggestion = suggestWin(pricing);
  if (!suggestion) {
    return {
      ...src,
      qpl: [],
      others: [],
      summary_zh: "缺少可建議的賠率",
      summary_en: "No quote within the odds cap to suggest.",
      confidence: Math.min(Number(src.confidence ?? 0.2), 0.2),
      data_freshness: "no_quote",
    };
  }
  return {
    ...src,
    qpl: [],
    others: [suggestion],
    summary_zh: "本輪建議未達最佳",
    summary_en: "Suggestion only. Not the best situation.",
    confidence: Math.min(Number(src.confidence ?? 0.2), 0.2),
    data_freshness: "suggestion",
  };
}

export function hasReleasableWin(pricing) {
  return (pricing ?? []).some((row) => {
    const odds = Number(row?.odds);
    const edge = Number(row?.edge);
    if (!(odds > 1) || !Number.isFinite(edge)) return false;
    if (MAX_BET_ODDS > 0 && odds > MAX_BET_ODDS) return false;
    return edge >= EDGE_MIN;
  });
}

/** When no win clears the gate, stake-like chat must say 未達最佳. */
export function labelSuggestionSpeech(text, pricing) {
  const body = String(text ?? "");
  if (!body.trim() || body.includes("未達最佳")) return body;
  if (hasReleasableWin(pricing) || !suggestWin(pricing)) return body;
  if (!/為軸|主攻|值得落注|正式推薦|維持/.test(body)) return body;
  return `${body}（未達最佳）`;
}

export function suggestionSpeechInstruction(pricing) {
  if (hasReleasableWin(pricing)) {
    return "若你的建議與上一輪相同，一句話講「維持 X 與 Y」即可，不得重列理由。";
  }
  const suggestion = suggestWin(pricing);
  if (!suggestion) return "本場沒有可沿用的獨贏。不可把任何馬寫成「為軸」或「主攻」。";
  return `若沿用上一輪獨贏，必須寫「維持未達最佳的獨贏 #${suggestion.combo}」。禁止寫「為軸」或「主攻」。`;
}

export function formatPricingBlock(pricing) {
  if (!pricing?.length) return "定價卡：缺少獨贏賠率，本輪不應產出注單。";
  const lines = pricing
    .slice()
    .sort((a, b) => Number(a.no) - Number(b.no))
    .map(
      (row) =>
        `#${row.no} odds ${row.odds} | market ${(row.market_prob * 100).toFixed(1)}% | model ${(row.model_prob * 100).toFixed(1)}% | edge ${row.edge.toFixed(3)}`
    );
  const suggestion = suggestWin(pricing);
  const note =
    !hasReleasableWin(pricing) && suggestion
      ? `沒有可放行的獨贏。沿用時寫「維持未達最佳的獨贏 #${suggestion.combo}」，不可寫「為軸」或「主攻」。`
      : "";
  return ["定價卡（程式計算，禁止自填百分比）", ...lines, note].filter(Boolean).join("\n");
}

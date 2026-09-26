import { z } from "zod";

export const COUNCIL_PRODUCTS = ["WIN", "PLA", "QIN", "QPL", "FCT", "TCE", "TRI", "FF", "QTT", "DBL"];

function toText(v, fallback = "") {
  if (v == null) return fallback;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => toText(x, "")).filter(Boolean).join("-");
  if (typeof v === "object") {
    const obj = v ?? {};
    const maybe =
      obj.combo ??
      obj.combination ??
      obj.selection ??
      obj.pick ??
      obj.horses ??
      obj.horse_numbers ??
      obj.horseNos ??
      "";
    return toText(maybe, fallback);
  }
  return fallback;
}

function toProduct(v, fallback = "WIN") {
  const p = toText(v, fallback).toUpperCase();
  return COUNCIL_PRODUCTS.includes(p) ? p : fallback;
}

function normalizePickRow(raw, defaultProduct = null) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const reasonZh = toText(obj.reason_zh ?? obj.reasonZh ?? obj.reason ?? obj.rationale_zh, "模型建議");
  const reasonEn = toText(obj.reason_en ?? obj.reasonEn ?? obj.reason ?? obj.rationale_en, "Model suggestion");
  const row = {
    combo: toText(obj.combo ?? obj.combination ?? obj.horses ?? obj.horse_numbers ?? obj.horseNos, "待定"),
    odds: toText(obj.odds ?? obj.odd ?? obj.market_odds, ""),
    ev_status: toText(obj.ev_status ?? obj.evStatus ?? obj.value_status, "").toLowerCase() === "positive" ? "positive" : "negative",
    reason_zh: reasonZh,
    reason_en: reasonEn,
  };
  if (defaultProduct) {
    row.product = toProduct(obj.product, defaultProduct);
  }
  return row;
}

function normalizeHorseNos(validHorseNos) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(validHorseNos) ? validHorseNos : []) {
    const n = Number.parseInt(String(x ?? "").trim(), 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function extractHorseNos(combo) {
  const matches = String(combo ?? "").match(/\d+/g) ?? [];
  const out = [];
  const seen = new Set();
  for (const m of matches) {
    const n = Number.parseInt(m, 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function expectedLegCount(product, fallback = 2) {
  const p = String(product ?? "").toUpperCase();
  if (p === "WIN" || p === "PLA") return 1;
  if (p === "QIN" || p === "QPL" || p === "DBL" || p === "FCT") return 2;
  if (p === "TCE" || p === "TRI") return 3;
  if (p === "FF" || p === "QTT") return 4;
  return fallback;
}

/** Ordered products: leg order matters (finish order), so never re-sort them. */
function isOrderedProduct(product) {
  const p = String(product ?? "").toUpperCase();
  return p === "FCT" || p === "TCE" || p === "QTT";
}

function sanitizeCombo(combo, validHorseNos, countHint, keepOrder = false) {
  const valid = normalizeHorseNos(validHorseNos);
  const validSet = new Set(valid);
  const parsed = extractHorseNos(combo);
  const expectedCount = Math.max(1, Number.isFinite(countHint) ? countHint : parsed.length || 1);
  const kept = [];
  const keptSeen = new Set();
  for (const n of parsed) {
    if (valid.length && !validSet.has(n)) continue;
    if (keptSeen.has(n)) continue;
    keptSeen.add(n);
    kept.push(n);
    if (kept.length >= expectedCount) break;
  }
  if (kept.length < expectedCount) return { normalizedCombo: null, changed: true };
  const finalNos = keepOrder ? kept.slice() : [...kept].sort((a, b) => a - b);
  const normalizedCombo = finalNos.join("-");
  const originalKey = keepOrder
    ? parsed.filter((n) => !valid.length || validSet.has(n)).slice(0, expectedCount).join("-")
    : [...parsed.filter((n) => !valid.length || validSet.has(n))]
        .sort((a, b) => a - b)
        .slice(0, expectedCount)
        .join("-");
  return { normalizedCombo, changed: normalizedCombo !== originalKey };
}

function markSystemFix(row) {
  return {
    ...row,
    reason_zh: `${row.reason_zh}（系統修正：馬號校正）`,
    reason_en: `${row.reason_en} (System correction: horse-number validation)`,
  };
}

const pickRow = z.object({
  combo: z.string().min(1),
  odds: z.string().optional().default(""),
  ev_status: z.enum(["positive", "negative"]).default("negative"),
  reason_zh: z.string().min(1),
  reason_en: z.string().min(1),
});

export const councilPicksSchema = z.object({
  summary_zh: z.string().min(1),
  summary_en: z.string().min(1),
  qpl: z.array(pickRow).max(3),
  others: z
    .array(
      pickRow.extend({
        product: z.enum(COUNCIL_PRODUCTS),
      })
    )
    .max(6),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  data_freshness: z.string().min(1).optional().default("snapshot"),
  updated_at_utc: z.string().optional().default(""),
  updated_at_hkt: z.string().optional().default(""),
});

export function parseCouncilPicks(raw, validHorseNos = []) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const rawQpl = Array.isArray(obj.qpl) ? obj.qpl : [];
  const rawOthers = Array.isArray(obj.others) ? obj.others : [];

  // Track combos across rows so corrections and fallbacks never repeat the same pair.
  const usedQplCombos = new Set();
  const qpl = [];
  for (const raw of rawQpl.slice(0, 3)) {
    const row = normalizePickRow(raw);
    const checked = sanitizeCombo(row.combo, validHorseNos, 2);
    if (!checked.normalizedCombo || usedQplCombos.has(checked.normalizedCombo)) continue;
    usedQplCombos.add(checked.normalizedCombo);
    qpl.push(checked.changed ? markSystemFix({ ...row, combo: checked.normalizedCombo }) : { ...row, combo: checked.normalizedCombo });
  }

  const usedOtherCombos = new Set();
  const others = [];
  for (const raw of rawOthers.slice(0, 6)) {
    const row = normalizePickRow(raw, "WIN");
    const legCount = expectedLegCount(row.product, 2);
    const checked = sanitizeCombo(row.combo, validHorseNos, legCount, isOrderedProduct(row.product));
    const comboKey = `${row.product}|${checked.normalizedCombo}`;
    if (!checked.normalizedCombo || usedOtherCombos.has(comboKey)) continue;
    usedOtherCombos.add(comboKey);
    others.push(checked.changed ? markSystemFix({ ...row, combo: checked.normalizedCombo }) : { ...row, combo: checked.normalizedCombo });
  }

  const confidenceNum = Number(obj.confidence ?? 0.5);
  const confidence = Number.isFinite(confidenceNum) ? Math.min(1, Math.max(0, confidenceNum)) : 0.5;
  const emptySlip = qpl.length === 0 && others.length === 0;

  const normalized = {
    summary_zh: emptySlip ? "本輪無正期望值" : toText(obj.summary_zh ?? obj.summaryZh ?? obj.summary, "暫無最終結論"),
    summary_en: emptySlip ? "No positive-EV bet this round." : toText(obj.summary_en ?? obj.summaryEn ?? obj.summary, "No final summary yet"),
    qpl,
    others,
    confidence,
    data_freshness: toText(obj.data_freshness ?? obj.dataFreshness, "snapshot"),
    updated_at_utc: toText(obj.updated_at_utc ?? obj.updatedAtUtc, ""),
    updated_at_hkt: toText(obj.updated_at_hkt ?? obj.updatedAtHkt, ""),
  };
  return councilPicksSchema.safeParse(normalized);
}


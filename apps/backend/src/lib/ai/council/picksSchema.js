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
    ev_status: toText(obj.ev_status ?? obj.evStatus ?? obj.value_status, "positive").toLowerCase() === "negative" ? "negative" : "positive",
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

function buildFallbackLegs(validHorseNos, count) {
  const valid = normalizeHorseNos(validHorseNos);
  if (!valid.length) return Array.from({ length: Math.max(1, count) }, (_, i) => i + 1);
  const out = [];
  const needed = Math.max(1, count);
  for (const n of valid) {
    out.push(n);
    if (out.length >= needed) break;
  }
  while (out.length < needed) out.push(valid[0]);
  return out;
}

function sanitizeCombo(combo, validHorseNos, countHint, keepOrder = false) {
  const valid = normalizeHorseNos(validHorseNos);
  const validSet = new Set(valid);
  const parsed = extractHorseNos(combo);
  const expectedCount = Math.max(1, Number.isFinite(countHint) ? countHint : parsed.length || 1);
  const kept = [];
  const keptSeen = new Set();
  for (const n of parsed) {
    if (!validSet.has(n)) continue;
    if (keptSeen.has(n)) continue;
    keptSeen.add(n);
    kept.push(n);
    if (kept.length >= expectedCount) break;
  }
  const fallback = buildFallbackLegs(valid, expectedCount);
  for (const n of fallback) {
    if (kept.length >= expectedCount) break;
    if (expectedCount > 1 && kept.includes(n)) continue;
    kept.push(n);
  }
  const finalNos = kept.slice(0, expectedCount);
  if (!keepOrder) finalNos.sort((a, b) => a - b);
  const normalizedCombo = finalNos.join("-");
  // For unordered products, "7-4-5" and "4-5-7" are the same pick — only flag
  // a real substitution, not a re-ordering.
  const originalKey = keepOrder
    ? parsed.join("-")
    : [...parsed].sort((a, b) => a - b).join("-");
  const finalKey = keepOrder ? normalizedCombo : [...finalNos].sort((a, b) => a - b).join("-");
  const changed = finalKey !== originalKey;
  return { normalizedCombo, changed };
}

function markSystemFix(row) {
  return {
    ...row,
    reason_zh: `${row.reason_zh}（系統修正：馬號校正）`,
    reason_en: `${row.reason_en} (System correction: horse-number validation)`,
  };
}

function pickUniquePair(validHorseNos, usedCombos) {
  const valid = normalizeHorseNos(validHorseNos);
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const combo = `${Math.min(valid[i], valid[j])}-${Math.max(valid[i], valid[j])}`;
      if (!usedCombos.has(combo)) return combo;
    }
  }
  return null;
}

function pickUniqueSingle(validHorseNos, usedCombos) {
  for (const n of normalizeHorseNos(validHorseNos)) {
    const combo = String(n);
    if (!usedCombos.has(combo)) return combo;
  }
  return null;
}

const pickRow = z.object({
  combo: z.string().min(1),
  odds: z.string().optional().default(""),
  ev_status: z.enum(["positive", "negative"]).default("positive"),
  reason_zh: z.string().min(1),
  reason_en: z.string().min(1),
});

export const councilPicksSchema = z.object({
  summary_zh: z.string().min(1),
  summary_en: z.string().min(1),
  qpl: z.array(pickRow).length(3),
  others: z
    .array(
      pickRow.extend({
        product: z.enum(COUNCIL_PRODUCTS),
      })
    )
    .min(2)
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
  const qpl = rawQpl.slice(0, 3).map((r) => {
    const row = normalizePickRow(r);
    const checked = sanitizeCombo(row.combo, validHorseNos, 2);
    let combo = checked.normalizedCombo;
    let changed = checked.changed;
    if (usedQplCombos.has(combo)) {
      const alt = pickUniquePair(validHorseNos, usedQplCombos);
      if (alt) {
        combo = alt;
        changed = true;
      }
    }
    usedQplCombos.add(combo);
    if (!changed) return { ...row, combo };
    return markSystemFix({ ...row, combo });
  });
  while (qpl.length < 3) {
    const fallbackPair = sanitizeCombo("", validHorseNos, 2).normalizedCombo;
    const combo = pickUniquePair(validHorseNos, usedQplCombos) ?? fallbackPair;
    usedQplCombos.add(combo);
    qpl.push({
      combo,
      odds: "",
      ev_status: "positive",
      reason_zh: "等待議會共識",
      reason_en: "Awaiting council consensus",
    });
  }

  const usedOtherCombos = new Set();
  const others = rawOthers.slice(0, 6).map((r) => {
    const row = normalizePickRow(r, "WIN");
    const legCount = expectedLegCount(row.product, 2);
    const checked = sanitizeCombo(row.combo, validHorseNos, legCount, isOrderedProduct(row.product));
    let combo = checked.normalizedCombo;
    let changed = checked.changed;
    const comboKey = `${row.product}|${combo}`;
    if (usedOtherCombos.has(comboKey)) {
      const alt = legCount === 1
        ? pickUniqueSingle(validHorseNos, new Set([...usedOtherCombos].map((k) => k.split("|")[1])))
        : pickUniquePair(validHorseNos, new Set([...usedOtherCombos].map((k) => k.split("|")[1])));
      if (alt) {
        combo = alt;
        changed = true;
      }
    }
    usedOtherCombos.add(`${row.product}|${combo}`);
    if (!changed) return { ...row, combo };
    return markSystemFix({ ...row, combo });
  });
  while (others.length < 2) {
    const product = others.length === 0 ? "WIN" : "QIN";
    const legCount = expectedLegCount(product, 2);
    const usedPlain = new Set([...usedOtherCombos].map((k) => k.split("|")[1]));
    const combo = legCount === 1
      ? (pickUniqueSingle(validHorseNos, usedPlain) ?? sanitizeCombo("", validHorseNos, 1).normalizedCombo)
      : (pickUniquePair(validHorseNos, usedPlain) ?? sanitizeCombo("", validHorseNos, 2).normalizedCombo);
    usedOtherCombos.add(`${product}|${combo}`);
    others.push({
      combo,
      odds: "",
      ev_status: "positive",
      reason_zh: "等待議會共識",
      reason_en: "Awaiting council consensus",
      product,
    });
  }

  const confidenceNum = Number(obj.confidence ?? 0.5);
  const confidence = Number.isFinite(confidenceNum) ? Math.min(1, Math.max(0, confidenceNum)) : 0.5;

  const normalized = {
    summary_zh: toText(obj.summary_zh ?? obj.summaryZh ?? obj.summary, "暫無最終結論"),
    summary_en: toText(obj.summary_en ?? obj.summaryEn ?? obj.summary, "No final summary yet"),
    qpl,
    others,
    confidence,
    data_freshness: toText(obj.data_freshness ?? obj.dataFreshness, "snapshot"),
    updated_at_utc: toText(obj.updated_at_utc ?? obj.updatedAtUtc, ""),
    updated_at_hkt: toText(obj.updated_at_hkt ?? obj.updatedAtHkt, ""),
  };
  return councilPicksSchema.safeParse(normalized);
}


export const NO_MEETING_PICK = "未有建議，未開會";
export const NOT_MENTIONED = "未提過";

function horseNumbers(combo) {
  const out = [];
  const seen = new Set();
  for (const match of String(combo ?? "").matchAll(/\d+/g)) {
    const n = Number(match[0]);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function messageMentionsHorse(text, horseNo) {
  const n = Number(horseNo);
  if (!Number.isFinite(n) || n <= 0) return false;
  const src = String(text ?? "");
  const token = String(n);
  const hash = new RegExp(`(?:^|[^\\d])#\\s*${token}(?!\\d)`);
  const hao = new RegExp(`(?:^|[^\\d])${token}\\s*號`);
  const ma = new RegExp(`馬號\\s*${token}(?!\\d)`);
  if (hash.test(src) || hao.test(src) || ma.test(src)) return true;
  const combos = src.match(/\d+(?:\s*[-/]\s*\d+)+/g) ?? [];
  for (const combo of combos) {
    const parts = combo.split(/[-/]/).map((part) => part.trim());
    if (parts.includes(token)) return true;
  }
  return false;
}

function clip(text, max = 160) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function extractMention(text, horseNo) {
  const parts = String(text ?? "").split(/(?<=[。！？\n])/);
  const hit = parts.find((part) => messageMentionsHorse(part, horseNo));
  return clip(hit || "");
}

function pickRows(picks) {
  const rows = [];
  for (const row of picks?.others ?? []) rows.push(row);
  for (const row of picks?.qpl ?? []) rows.push({ ...row, product: row?.product || "QPL" });
  return rows;
}

export function winSuggestion(picks) {
  const row = pickRows(picks).find((item) => String(item?.product ?? "").toUpperCase() === "WIN");
  if (!row) return null;
  const nos = horseNumbers(row.combo);
  if (nos.length !== 1) return null;
  return {
    horseNo: nos[0],
    reason: clip(row.reason_zh || row.reason_en || "", 220),
    odds: String(row.odds ?? "").trim(),
  };
}

export function followOnLines(picks) {
  const wanted = new Set(["PLA", "QIN", "QPL"]);
  const lines = [];
  for (const row of pickRows(picks)) {
    const product = String(row?.product ?? "").toUpperCase();
    if (!wanted.has(product)) continue;
    if (product === "WIN") continue;
    const combo = String(row?.combo ?? "").trim();
    if (!combo) continue;
    lines.push({
      product,
      combo,
      reason: clip(row.reason_zh || row.reason_en || "", 160),
    });
  }
  return lines;
}

export function commentsForHorse(horseNo, { messages, picks } = {}) {
  const quotes = [];
  const seen = new Set();
  const push = (quote) => {
    const key = `${quote.kind}|${quote.product || ""}|${quote.text}`;
    if (!quote.text || seen.has(key)) return;
    seen.add(key);
    quotes.push(quote);
  };
  for (const row of pickRows(picks)) {
    if (!horseNumbers(row.combo).includes(Number(horseNo))) continue;
    const text = clip(row.reason_zh || row.reason_en || "");
    push({
      kind: "pick",
      product: String(row.product || "").toUpperCase(),
      speaker: "",
      text,
    });
  }
  for (const message of messages ?? []) {
    const content = String(message?.content ?? "");
    if (!messageMentionsHorse(content, horseNo)) continue;
    const text = extractMention(content, horseNo);
    push({
      kind: "transcript",
      product: "",
      speaker: String(message?.meta_json?.speaker || message?.role || "").trim(),
      text,
    });
  }
  return quotes;
}

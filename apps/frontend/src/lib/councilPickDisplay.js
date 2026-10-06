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

const NEGATIVE_VIEWS = ["不看好", "唔看好", "不支持", "不保留", "降權", "減分", "剔除", "否決", "駁回", "陷阱", "過熱", "避開", "放棄", "風險過高", "劣勢", "不建議", "負面"];
const POSITIVE_VIEWS = ["升權", "加分", "看好", "優勢", "保留", "被低估", "低估", "可信", "支持", "值博", "正面"];

function toneScore(text) {
  let src = String(text ?? "");
  let pos = 0;
  let neg = 0;
  for (const word of NEGATIVE_VIEWS) {
    if (!src.includes(word)) continue;
    neg += 1;
    src = src.split(word).join("");
  }
  for (const word of POSITIVE_VIEWS) {
    if (src.includes(word)) pos += 1;
  }
  return { pos, neg };
}

export function listRoundNumbers(messages) {
  const seen = new Set();
  for (const message of messages ?? []) {
    const n = Number(message?.meta_json?.round_no ?? 0);
    if (n > 0) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** positive | negative | none. none is no discussion, or discussion without a clear view. */
export function horseNameView(quotes) {
  let pos = 0;
  let neg = 0;
  for (const quote of quotes ?? []) {
    const ev = String(quote?.ev_status ?? "").toLowerCase();
    if (ev === "negative") neg += 2;
    else if (ev === "positive") pos += 2;
    const tone = toneScore(quote?.text);
    pos += tone.pos;
    neg += tone.neg;
  }
  if (neg > pos) return "negative";
  if (pos > neg) return "positive";
  return "none";
}

export function commentsForHorse(horseNo, { messages, picks, roundNo } = {}) {
  const quotes = [];
  const seen = new Set();
  const wantedRound = Number(roundNo);
  const filterRound = Number.isFinite(wantedRound) && wantedRound > 0;
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
      ev_status: String(row.ev_status ?? "").toLowerCase(),
      speaker: "",
      text,
    });
  }
  for (const message of messages ?? []) {
    const messageRound = Number(message?.meta_json?.round_no ?? 0);
    if (filterRound && messageRound !== wantedRound) continue;
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

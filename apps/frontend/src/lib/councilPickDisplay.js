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
    const parts = combo.split(/[-/]/).map((part) => String(Number(part.trim())));
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

function isMissingBuy(buy) {
  const text = String(buy ?? "").trim();
  return !text || text.includes("沒有建議");
}

function discussionMessages(messages, roundNo) {
  const round = Number(roundNo);
  const filterRound = Number.isFinite(round) && round > 0;
  return (messages ?? []).filter((message) => {
    const meta = message?.meta_json ?? {};
    const speaker = String(meta.speaker || meta.agent_code || "").toLowerCase();
    if (speaker === "bookie" || speaker === "system" || speaker === "kelly") return false;
    const messageRound = Number(meta.round_no ?? 0);
    if (filterRound && messageRound !== round) return false;
    const content = String(message?.content ?? "");
    if (!content.trim() || content.includes("暫無最終結論")) return false;
    return true;
  });
}

function comboContaining(text, horseNo) {
  const token = String(Number(horseNo));
  const combos = String(text ?? "").match(/\d+(?:\s*[-/]\s*\d+)+/g) ?? [];
  for (const combo of combos) {
    const parts = combo.split(/[-/]/).map((part) => String(Number(part.trim())));
    if (parts.includes(token)) return parts.join("-");
  }
  return "";
}

function buyFromDiscussion(text, horseNo) {
  const src = String(text ?? "");
  const combo = comboContaining(src, horseNo);
  if (/位置Q|QPL/i.test(src) && combo) return `位置Q ${combo}`;
  if (/連贏|QIN/i.test(src) && combo) return `連贏 ${combo}`;
  if (/獨贏|WIN/i.test(src)) return "獨贏";
  if (combo) return `位置Q ${combo}`;
  return "獨贏";
}

function stakeFromDiscussion(text) {
  const src = String(text ?? "");
  const suggested = src.match(/建議\s*\d+(?:\.\d+)?\s*注/);
  if (suggested && !/不落注/.test(src.slice(suggested.index, suggested.index + suggested[0].length + 8))) {
    return suggested[0];
  }
  return "低信心，不落注";
}

function viewFromDiscussion(text) {
  const tone = toneScore(text);
  if (tone.neg > tone.pos) return "negative";
  if (tone.pos > tone.neg) return "positive";
  return "none";
}

function noteFromDiscussion(horseNo, messages, roundNo) {
  const rows = discussionMessages(messages, roundNo).filter((message) =>
    messageMentionsHorse(message.content, horseNo)
  );
  const sentences = rows.map((message) => extractMention(message.content, horseNo)).filter(Boolean);
  if (!sentences.length) return null;
  const text = sentences.join(" ");
  return {
    horse_no: Number(horseNo),
    summary_zh: clip(sentences[0], 180),
    buy_zh: buyFromDiscussion(text, horseNo),
    stake_zh: stakeFromDiscussion(text),
    view: viewFromDiscussion(text),
  };
}

/** positive | negative | none. none is no discussion, or discussion without a clear view. */
export function horseNoteFor(horseNo, { messages, picks, roundNo } = {}) {
  const wanted = Number(horseNo);
  const round = Number(roundNo);
  const filterRound = Number.isFinite(round) && round > 0;
  const collected = [];
  for (const message of messages ?? []) {
    const meta = message?.meta_json ?? {};
    if (!Array.isArray(meta.horse_notes)) continue;
    const speaker = String(meta.speaker || meta.agent_code || "").toLowerCase();
    if (speaker && speaker !== "bookie") continue;
    const messageRound = Number(meta.round_no ?? 0);
    if (filterRound && messageRound !== round) continue;
    collected.push(...meta.horse_notes);
  }
  let notes = collected;
  if (!notes.length) {
    const picksRound = Number(picks?._status?.round_no ?? 0);
    if (!filterRound || !picksRound || picksRound === round) {
      notes = Array.isArray(picks?.horse_notes) ? picks.horse_notes : [];
    }
  }
  const stored = notes.find((note) => Number(note?.horse_no) === wanted) ?? null;
  const discussed = noteFromDiscussion(wanted, messages, filterRound ? round : undefined);
  if (!stored) return discussed;
  if (!discussed) return stored;
  return {
    ...stored,
    summary_zh: stored.summary_zh || discussed.summary_zh,
    buy_zh: isMissingBuy(stored.buy_zh) ? discussed.buy_zh : stored.buy_zh,
    stake_zh: stored.stake_zh || discussed.stake_zh,
  };
}

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

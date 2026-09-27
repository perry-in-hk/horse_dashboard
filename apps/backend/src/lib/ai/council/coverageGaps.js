/**
 * Horses and pairs the meeting has not named yet.
 * A priced drop or a mid-odds quote can stay out of the slip and still has to be said out loud.
 */

function mentionedHorseNos(text) {
  const found = new Set();
  const body = String(text ?? "");
  for (const match of body.matchAll(/#(\d{1,2})\b/g)) {
    found.add(String(Number(match[1])));
  }
  for (const match of body.matchAll(/\b(\d{1,2})\s*[-,/]\s*(\d{1,2})\b/g)) {
    found.add(String(Number(match[1])));
    found.add(String(Number(match[2])));
  }
  return found;
}

function newDropKeys(momentumBlock) {
  const keys = [];
  for (const line of String(momentumBlock ?? "").split("\n")) {
    if (!line.includes("[NEW")) continue;
    const match = line.match(/key\s+([0-9,\s]+)\s*:/i);
    if (!match) continue;
    const parts = match[1]
      .split(",")
      .map((part) => String(Number(part.trim())))
      .filter((part) => part !== "NaN" && part !== "0");
    if (parts.length) keys.push(parts.join(","));
  }
  return keys;
}

function transcriptText(transcript) {
  return (Array.isArray(transcript) ? transcript : [])
    .map((row) => String(row?.content ?? ""))
    .join("\n");
}

/**
 * @param {{ oddsMomentumBlock?: string, pricing?: { no?: string, odds?: number }[] }} context
 * @param {unknown[]} transcript
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function listCoverageGaps(context, transcript, opts = {}) {
  const limit = opts.limit ?? 4;
  const mentioned = mentionedHorseNos(transcriptText(transcript));
  const lines = [];
  const seen = new Set();
  for (const key of newDropKeys(context?.oddsMomentumBlock)) {
    const legs = key.split(",");
    if (legs.every((leg) => mentioned.has(leg))) continue;
    const label = legs.length > 1 ? `組合 ${key}` : `#${legs[0]}`;
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(label);
    if (lines.length >= limit) return lines;
  }
  const mids = (Array.isArray(context?.pricing) ? context.pricing : [])
    .filter((row) => {
      const no = String(Number(row?.no));
      const odds = Number(row?.odds);
      return no !== "NaN" && no !== "0" && !mentioned.has(no) && odds > 4 && odds <= 15;
    })
    .sort((a, b) => Number(a.odds) - Number(b.odds));
  for (const row of mids) {
    const label = `#${Number(row.no)} 獨贏 ${row.odds}`;
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(label);
    if (lines.length >= limit) break;
  }
  return lines;
}

export function formatCoverageBlock(context, transcript) {
  const gaps = listCoverageGaps(context, transcript);
  if (!gaps.length) return "";
  return [
    "## 尚未點名",
    "以下項目有新的賠率急跌，或獨贏介於 4 倍到 15 倍，而且會議紀錄還沒出現過。",
    "本輪第一句必須點名其中一項，並寫出池種或獨贏賠率。可以反對，不可只用近績寫成「無效資金」就跳過。",
    "這份清單不是注單。沒有正期望值的項目仍然不能放進共識注單。",
    ...gaps.map((line) => `- ${line}`),
  ].join("\n");
}

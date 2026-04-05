import { z } from "zod";

/** @param {string} s */
function indentBodyLines(s) {
  const trimmed = String(s ?? "").trim();
  if (!trimmed) return ["        （無特別說明。）"];
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `        ${line}`);
}

const poolPickSchema = z.object({
  combo: z.string(),
  odds: z.string().optional(),
  reason: z.string(),
});

/** LLM JSON output — validated before rendering to fixed Markdown layout. */
export const raceAnalysisJsonSchema = z.object({
  overview: z.object({
    raceDateLine: z.string(),
    venueLine: z.string(),
    raceNoLine: z.string(),
    fieldSummary: z.string(),
    marketFocus: z.string(),
    situationSummary: z.string(),
  }),
  /** Body only (no outer ##); may use subheadings, bullets, blank lines — 繁體中文 */
  qplQinSection: z.string(),
  /** 大注理論：與「Odds momentum」呼應；分欄與職業馬迷章節對齊 — 繁體中文 */
  bigMoney: z.object({
    summary: z.string(),
    win: z.string(),
    pla: z.string(),
    qpl: z.string(),
    qin: z.string(),
  }),
  proPunter: z.object({
    introLine: z.string().optional(),
    win: z.object({
      main: z.string(),
      alternate: z.string().optional(),
    }),
    pla: z.array(z.string()).min(2).max(8),
    qpl: z.array(poolPickSchema).max(8).optional().default([]),
    qin: z.array(poolPickSchema).max(8).optional().default([]),
  }),
  riskNotice: z.string(),
});

/**
 * @param {unknown} raw
 * @returns {{ success: true, data: z.infer<typeof raceAnalysisJsonSchema> } | { success: false, error: z.ZodError }}
 */
export function parseRaceAnalysisJson(raw) {
  const r = raceAnalysisJsonSchema.safeParse(raw);
  if (!r.success) return { success: false, error: r.error };
  return { success: true, data: r.data };
}

/**
 * Deterministic Markdown matching the dashboard “fixed format” example.
 * @param {z.infer<typeof raceAnalysisJsonSchema>} data
 */
export function renderAnalysisToMarkdown(data) {
  const o = data.overview;
  const p = data.proPunter;
  const intro =
    p.introLine?.trim() ||
    "以下為模擬職業馬迷，基於現有賠率及有限往績資料，可能考慮的具體投注選項：";

  const parts = [];

  parts.push("## 賽事概覽");
  parts.push("");
  parts.push(`    賽事日期： ${o.raceDateLine}`);
  parts.push(`    場地： ${o.venueLine}`);
  parts.push(`    賽次： ${o.raceNoLine}`);
  parts.push(`    參賽馬匹： ${o.fieldSummary}`);
  parts.push(`    市場焦點： ${o.marketFocus}`);
  parts.push(`    形勢簡評： ${o.situationSummary}`);
  parts.push("");

  parts.push("## 位置Q（QPL）與連贏（QIN）");
  parts.push("");
  parts.push(data.qplQinSection.trim());
  parts.push("");

  parts.push("## 職業馬迷視角：假設性彩池取向");
  parts.push("");
  parts.push(intro);
  parts.push("");

  parts.push("    獨贏（WIN）：");
  parts.push(`        主選：${p.win.main.trim()}`);
  if (p.win.alternate?.trim()) {
    parts.push(`        備選：${p.win.alternate.trim()}`);
  }
  parts.push("");

  parts.push("    位置（PLA）：");
  parts.push("        心水馬匹（按穩健程度排序）：");
  for (const line of p.pla) {
    parts.push(`            ${line.trim()}`);
  }
  parts.push("");

  parts.push("    位置Q（QPL）：");
  parts.push("        具體組合與理由：");
  if (p.qpl.length === 0) {
    parts.push("            （因快照無此池資料或無法建議具體組合，從略。）");
  } else {
    for (const row of p.qpl) {
      const oddsBit = row.odds?.trim() ? `（${row.odds.trim()}）` : "";
      parts.push(`            「${row.combo.trim()}」${oddsBit}：${row.reason.trim()}`);
    }
  }
  parts.push("");

  parts.push("    連贏（QIN）：");
  parts.push("        具體組合與理由：");
  if (p.qin.length === 0) {
    parts.push("            （因快照無此池資料或無法建議具體組合，從略。）");
  } else {
    for (const row of p.qin) {
      const oddsBit = row.odds?.trim() ? `（${row.odds.trim()}）` : "";
      parts.push(`            「${row.combo.trim()}」${oddsBit}：${row.reason.trim()}`);
    }
  }
  parts.push("");

  parts.push("## 大注資金流追蹤（短時間賠率急跌）");
  parts.push("");
  const bm = data.bigMoney;
  parts.push(`    摘要： ${bm.summary.trim()}`);
  parts.push("");
  parts.push("    獨贏（WIN）：");
  for (const line of indentBodyLines(bm.win)) {
    parts.push(line);
  }
  parts.push("");
  parts.push("    位置（PLA）：");
  for (const line of indentBodyLines(bm.pla)) {
    parts.push(line);
  }
  parts.push("");
  parts.push("    位置Q（QPL）：");
  for (const line of indentBodyLines(bm.qpl)) {
    parts.push(line);
  }
  parts.push("");
  parts.push("    連贏（QIN）：");
  for (const line of indentBodyLines(bm.qin)) {
    parts.push(line);
  }
  parts.push("");

  parts.push(`風險提示： ${data.riskNotice.trim()}`);

  return parts.join("\n");
}

/**
 * Strip optional ```json fences from model output.
 * @param {string} content
 */
export function extractJsonFromMessage(content) {
  let s = content.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i;
  const m = s.match(fence);
  if (m) s = m[1].trim();
  return s;
}

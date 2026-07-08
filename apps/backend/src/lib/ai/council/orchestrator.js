import { COUNCIL_AGENTS, COUNCIL_AGENT_ORDER, STAGE2_REVIEW_PROMPT } from "./agents.js";
import { callAgentChat } from "./callAgent.js";
import { parseCouncilPicks } from "./picksSchema.js";
import { formatHktDateTime, toUtcIso } from "../../timeHkt.js";

function truncateText(s, max = 16000) {
  const text = String(s ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated]`;
}

function parseHorseNo(v) {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtOdds(v) {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function buildRunnersTable(context) {
  const runners = Array.isArray(context?.runners) ? context.runners : [];
  if (!runners.length) return "- (no runners)";
  const win = context?.oddsSummary?.win ?? {};
  const pla = context?.oddsSummary?.pla ?? {};
  const rows = [...runners]
    .map((r) => ({
      no: parseHorseNo(r?.no ?? r?.horseNo ?? r?.number),
      name: String(r?.horse_name ?? r?.name ?? r?.horseName ?? "?").trim(),
    }))
    .filter((r) => r.no != null)
    .sort((a, b) => a.no - b.no)
    .map((r) => {
      const key = String(r.no);
      return `#${r.no} ${r.name} | WIN ${fmtOdds(win[key])} | PLA ${fmtOdds(pla[key])}`;
    });
  return rows.length ? rows.join("\n") : "- (no runners)";
}

function buildPairPoolsText(context) {
  const pairPools = context?.pairPools ?? {};
  const qinRows = Array.isArray(pairPools.qin) ? pairPools.qin.slice(0, 12) : [];
  const qplRows = Array.isArray(pairPools.qpl) ? pairPools.qpl.slice(0, 12) : [];
  const toLine = (r) => `${String(r?.comb ?? "").trim()} @ ${fmtOdds(r?.odds)}`;
  const qinText = qinRows.length ? qinRows.map(toLine).join("\n") : "- (no QIN lines)";
  const qplText = qplRows.length ? qplRows.map(toLine).join("\n") : "- (no QPL lines)";
  return [
    `source=${String(pairPools.source ?? "none")}, observed_at=${String(pairPools.observed_at ?? "-")}`,
    "",
    "[QIN top lines]",
    qinText,
    "",
    "[QPL top lines]",
    qplText,
  ].join("\n");
}

function buildAllPoolsText(context) {
  const pools = context?.allPools?.pools ?? {};
  const entries = Object.entries(pools);
  if (!entries.length) return "- (no pools)";
  const blocks = [];
  for (const [poolCode, rows] of entries) {
    const top = Array.isArray(rows) ? rows.slice(0, 8) : [];
    const body = top.length
      ? top.map((r) => `${String(r?.comb ?? "").trim()} @ ${fmtOdds(r?.odds)}`).join("\n")
      : "-";
    blocks.push(`[${poolCode}]`, body);
  }
  return blocks.join("\n");
}

function buildFormSummary(context) {
  const formByHorse = Array.isArray(context?.formByHorse) ? context.formByHorse : [];
  const runners = Array.isArray(context?.runners) ? context.runners : [];
  const noByCode = new Map(
    runners
      .map((r) => [String(r?.horse_code ?? "").trim().toUpperCase(), parseHorseNo(r?.no)])
      .filter((x) => x[0] && x[1] != null)
  );
  const lines = [];
  for (const horse of formByHorse) {
    const code = String(horse?.horse_code ?? "").trim().toUpperCase();
    const horseNo = noByCode.get(code);
    if (!horseNo) continue;
    const horseName = String(horse?.horse_name ?? code).trim();
    const rows = Array.isArray(horse?.rows) ? horse.rows.slice(0, 5) : [];
    const posSeq = rows.map((r) => String(r?.finish_position ?? "-").trim()).join("/");
    const scores = rows.map((r) => Number(r?.race_score)).filter((n) => Number.isFinite(n));
    const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "-";
    lines.push(
      `#${horseNo} ${horseName} | 近5名次 ${posSeq || "-"} | avgScore ${avgScore} | 樣本 ${rows.length}`
    );
  }
  lines.sort((a, b) => {
    const na = parseHorseNo(a.match(/^#(\d+)/)?.[1]);
    const nb = parseHorseNo(b.match(/^#(\d+)/)?.[1]);
    if (!na && !nb) return 0;
    if (!na) return 1;
    if (!nb) return -1;
    return na - nb;
  });
  return lines.length ? lines.join("\n") : "- (no form rows)";
}

function buildContextText(context) {
  const oddsSummary = context?.oddsSummary ?? {};
  return truncateText(
    [
      "## RaceContext",
      `race_key: ${context.meeting_date} ${context.venue_code} R${context.race_no}`,
      "所有馬匹與組合請一律用馬號（例：#3 馬名、3-7）。",
      "",
      "### RunnersTable",
      buildRunnersTable(context),
      "",
      "### OddsSummary",
      `source=${String(oddsSummary.source ?? "none")}, observed_at=${String(oddsSummary.observed_at ?? "-")}`,
      "",
      "### PairPools",
      buildPairPoolsText(context),
      "",
      "### AllPools",
      buildAllPoolsText(context),
      "",
      "### FormByHorseSummary",
      buildFormSummary(context),
      "",
      "### OddsMomentum",
      context.oddsMomentumBlock ?? "",
    ].join("\n")
  );
}

function buildUserProposalText(userMessages) {
  const rows = (userMessages ?? []).slice(-20).map((m) => {
    const name = m.username || `user#${m.user_id ?? "?"}`;
    return `- ${name}: ${String(m.content ?? "").trim()}`;
  });
  return rows.length ? rows.join("\n") : "- (no user proposals)";
}

function stage1Prompt(context, userMessages) {
  return [
    "你正在參與 HKJC AI 投注議會 Stage 1。",
    "請給出你的專業觀點，包含：",
    "1) 主要候選馬與理由",
    "2) 你對 QPL 與其他彩池的建議組合方向",
    "3) 風險提醒",
    "",
    "## UserProposals",
    buildUserProposalText(userMessages),
    "",
    buildContextText(context),
  ].join("\n");
}

function parseRankingFromText(rankingText) {
  const text = String(rankingText ?? "");
  if (text.includes("FINAL RANKING:")) {
    const parts = text.split("FINAL RANKING:");
    if (parts.length >= 2) {
      const section = parts[1];
      const numbered = section.match(/\d+\.\s*Response [A-Z]/g);
      if (numbered?.length) {
        return numbered.map((m) => m.match(/Response [A-Z]/)?.[0]).filter(Boolean);
      }
      const fallback = section.match(/Response [A-Z]/g);
      if (fallback?.length) return fallback;
    }
  }
  return text.match(/Response [A-Z]/g) ?? [];
}

function calculateAggregateRankings(stage2Results, labelToModel) {
  const positions = new Map();
  for (const row of stage2Results) {
    for (let i = 0; i < row.parsed_ranking.length; i++) {
      const label = row.parsed_ranking[i];
      const model = labelToModel[label];
      if (!model) continue;
      if (!positions.has(model)) positions.set(model, []);
      positions.get(model).push(i + 1);
    }
  }
  const out = [];
  for (const [model, vals] of positions.entries()) {
    if (!vals.length) continue;
    out.push({
      model,
      average_rank: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
      rankings_count: vals.length,
    });
  }
  out.sort((a, b) => a.average_rank - b.average_rank);
  return out;
}

function buildValidHorseNos(context) {
  const runners = Array.isArray(context?.runners) ? context.runners : [];
  const fromRunners = runners
    .map((r) => parseHorseNo(r?.no ?? r?.horseNo ?? r?.number))
    .filter((n) => n != null);
  const uniq = [...new Set(fromRunners)];
  if (!uniq.length) return [];
  const winMap = context?.oddsSummary?.win ?? {};
  const withOdds = uniq
    .map((no) => {
      const v = Number(winMap[String(no)]);
      return { no, odds: Number.isFinite(v) ? v : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => {
      if (a.odds !== b.odds) return a.odds - b.odds;
      return a.no - b.no;
    })
    .map((x) => x.no);
  return withOdds;
}

function buildFallbackPicks(context) {
  const nums = (context?.runners ?? [])
    .map((r) => Number.parseInt(String(r?.horseNo ?? r?.no ?? r?.number ?? 0), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 4);
  const uniq = [...new Set(nums)];
  const [a, b, c, d] = [uniq[0] ?? 1, uniq[1] ?? 2, uniq[2] ?? 3, uniq[3] ?? 4];
  const mk = (x, y) => `${Math.min(x, y)}-${Math.max(x, y)}`;
  return {
    summary_zh: "Bookie JSON 輸出異常，已採用保底建議（請人工覆核）。",
    summary_en: "Bookie JSON output invalid; fallback picks applied (manual review advised).",
    qpl: [
      { combo: mk(a, b), odds: "", ev_status: "positive", reason_zh: "保底配對 1", reason_en: "Fallback pair 1" },
      { combo: mk(a, c), odds: "", ev_status: "positive", reason_zh: "保底配對 2", reason_en: "Fallback pair 2" },
      { combo: mk(b, c), odds: "", ev_status: "positive", reason_zh: "保底配對 3", reason_en: "Fallback pair 3" },
    ],
    others: [
      { product: "WIN", combo: String(a), odds: "", ev_status: "positive", reason_zh: "保底獨贏", reason_en: "Fallback WIN" },
      { product: "QIN", combo: mk(a, d), odds: "", ev_status: "positive", reason_zh: "保底位置Q", reason_en: "Fallback QIN" },
    ],
    confidence: 0.2,
    data_freshness: "fallback",
    updated_at_utc: "",
    updated_at_hkt: "",
  };
}

function pickRecentTranscript(transcript, maxItems = 30) {
  const rows = Array.isArray(transcript) ? transcript.slice(-maxItems) : [];
  return rows
    .map((m) => {
      const speaker = String(m?.speaker ?? m?.agent_code ?? m?.role ?? "unknown");
      const roundNo = Number(m?.round_no ?? 0);
      const turnNo = Number(m?.turn_no ?? 0);
      const content = truncateText(String(m?.content ?? ""), 1800);
      const ref = roundNo > 0 ? `R${roundNo}/T${turnNo || "?"}` : "R?/T?";
      return `[${ref}] ${speaker}: ${content}`;
    })
    .join("\n\n");
}

function normalizeSequence(raw) {
  if (!Array.isArray(raw)) return COUNCIL_AGENT_ORDER.slice();
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const code = String(x ?? "").trim().toLowerCase();
    if (!COUNCIL_AGENT_ORDER.includes(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  if (!out.length) return COUNCIL_AGENT_ORDER.slice();
  for (const code of COUNCIL_AGENT_ORDER) {
    if (!seen.has(code)) out.push(code);
  }
  return out;
}

function parseJsonSafe(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeUserDisposition(v) {
  const d = String(v ?? "").trim().toLowerCase();
  if (d === "accepted" || d === "parked" || d === "rejected") return d;
  return "parked";
}

function buildAnalystTurnPrompt({
  context,
  userMessages,
  pendingUserMessages,
  transcript,
  roundNo,
  turnNo,
  speakerCode,
  previousSpeaker,
  chairDirective,
  chairRuling,
}) {
  const pending = Array.isArray(pendingUserMessages) ? pendingUserMessages : [];
  const chairBlock = [];
  if (chairRuling) {
    chairBlock.push(`主席上輪裁決（已定案，除非出現裁決中列明的翻案條件，禁止再爭論）：${chairRuling}`);
  }
  if (chairDirective) {
    chairBlock.push(`主席指派給你的本輪任務（必須先完成）：${chairDirective}`);
  }
  chairBlock.push("使用者發言由秘書 Kelly 統一回應；只有當內容與你的專業直接相關時才簡短回應，否則專注推進分析。");
  const userBlock = pending.length
    ? [
        "## 新使用者發言（由秘書 Kelly 統一回應，你只需在與你的專業直接相關時參考）",
        buildUserProposalText(pending),
      ]
    : [
        "## 新使用者發言",
        "無。過往使用者問題已回答過，禁止再重複回應舊問題，也不要在開場重提舊問題。",
      ];
  return [
    "你正在 HKJC AI Council 真互聊會議中。",
    `當前回合: Round ${roundNo}, Turn ${turnNo}, Speaker: ${speakerCode}`,
    previousSpeaker ? `上一位發言者: ${previousSpeaker}` : "上一位發言者: 無",
    ...chairBlock,
    "請以會議對話口吻，控制在 4-12 句，務實具體，避免超長報告。",
    "反重複硬性規則（違反即視為失職）：",
    "1) MeetingTranscript 中你自己之前講過的內容一律不可複述（包括開場白、同一組賠率、同一段近績）。",
    "2) 本輪只講增量：a) 自上一輪以來的數據變化（賠率、動量、新訊號）；b) 一個新觀點，或對其他成員的具體質疑/反駁；c) 更新後的組合建議。",
    "3) 若你的建議與上一輪相同，一句話講「維持 X 與 Y」即可，不得重列理由。",
    "4) 若無新數據且你完全同意現有共識，總長不得超過 3 句。",
    "你必須：",
    "1) 推進討論（使用者發言由 Kelly 回應，不要代答）",
    "2) 回應上一位分析師的關鍵觀點（若有）",
    "3) 提供你對下一步可執行建議（QPL/其他池方向）",
    "",
    ...userBlock,
    "",
    // Sparse context (per multi-agent-debate research): a short window keeps
    // the discussion moving instead of encouraging agents to echo old rounds.
    "## MeetingTranscript（僅最近片段）",
    pickRecentTranscript(transcript, 14) || "(empty transcript)",
    "",
    buildContextText(context),
  ].join("\n");
}

const KELLY_RELAY_RE = /^>>\s*轉達首席[:：]\s*(.+)$/m;

function buildKellyTurnPrompt({ context, transcript, roundNo, userMessages }) {
  return [
    "你是會議秘書 Kelly，正在 HKJC AI Council 會議中。你的發言排在首席分析師總結之前。",
    `當前回合: Round ${roundNo}`,
    "",
    "## 待回應的使用者發言（全部由你回應）",
    buildUserProposalText(userMessages),
    "",
    "回覆規則提醒：",
    "1) 問題 → 根據下方 MeetingTranscript 回答，註明引用哪位成員的觀點；會議未討論過就坦白說。",
    "2) 指令 → 合理就在回覆最後一行單獨輸出「>> 轉達首席：<具體任務>」（僅此一行，只影響下一輪）；不合理就婉拒並說明，不輸出轉達行。",
    "3) 一次回覆處理上方所有發言。",
    "",
    "## MeetingTranscript（最近片段）",
    pickRecentTranscript(transcript, 20) || "(empty transcript)",
    "",
    buildContextText(context),
  ].join("\n");
}

function buildBookieJsonExample({ validHorseNos, latestUserSeq, shouldFinalize }) {
  const nos = Array.isArray(validHorseNos) && validHorseNos.length >= 4
    ? validHorseNos.slice(0, 4)
    : [1, 2, 3, 4];
  const [a, b, c, d] = nos;
  const mk = (x, y) => `${Math.min(x, y)}-${Math.max(x, y)}`;
  const example = {
    round_summary_zh: "本輪變化：#7 WIN 由 9.8 跌至 8.5，QPL 主攻改為 3-7；信心由 0.58 升至 0.62（資金訊號確認）。",
    round_summary_en: "This round: #7 WIN dropped from 9.8 to 8.5; QPL focus shifts to 3-7; confidence up to 0.62 on confirmed money flow.",
    member_verdicts: [
      { agent: "quant", verdict: "adopt", reason_zh: "#7 資金流入判讀有數據支持" },
      { agent: "historian", verdict: "partial", reason_zh: "#3 場地適配成立，但升權幅度缺乏市場佐證" },
      { agent: "trend", verdict: "reject", reason_zh: "重複上輪已否決的舊訊號，無新內容" },
      { agent: "scout", verdict: "adopt", reason_zh: "剔除 #4 相關組合的現實檢核合理" },
    ],
    ruling_zh: "裁決：#3 納入次選、#5 剔出候選；除非 #5 WIN 跌破 9.0，此議題不再討論。",
    directives: [
      { agent: "quant", task_zh: "核對 QPL 3-7 與 2-7 現價差，判斷哪個值博率高" },
      { agent: "historian", task_zh: "只補充 #7 的檔位與騎練數據，不要重談 #3" },
      { agent: "trend", task_zh: "只報本輪之後的新 drop；無新訊號就評 QPL 3-7 的入場時機" },
      { agent: "scout", task_zh: "確認最終候選清單，剔除無資金背書的組合" },
    ],
    user_disposition: "parked",
    latest_user_seq: Number.isFinite(Number(latestUserSeq)) ? Number(latestUserSeq) : -1,
    next_sequence: ["quant", "historian", "trend", "scout"],
    current_picks: {
      summary_zh: "主推 QPL 組合，並覆蓋 WIN/PLA/QIN/FCT/TRI 各一注。",
      summary_en: "Primary QPL combos with WIN/PLA/QIN/FCT/TRI coverage.",
      qpl: [
        { combo: mk(a, b), odds: "6.5", ev_status: "positive", reason_zh: "賠率支持且近況佳", reason_en: "Odds support and good recent form" },
        { combo: mk(a, c), odds: "9.2", ev_status: "neutral", reason_zh: "次選配對", reason_en: "Secondary pair" },
        { combo: mk(b, c), odds: "11.0", ev_status: "neutral", reason_zh: "防冷配對", reason_en: "Cover pair" },
      ],
      others: [
        { product: "WIN", combo: String(a), odds: "3.4", ev_status: "positive", reason_zh: "#馬號 大熱可信", reason_en: "Reliable favourite" },
        { product: "PLA", combo: String(b), odds: "2.1", ev_status: "positive", reason_zh: "#馬號 位置穩定", reason_en: "Consistent placer" },
        { product: "QIN", combo: mk(a, d), odds: "18.0", ev_status: "neutral", reason_zh: "搏冷", reason_en: "Value longshot" },
        { product: "FCT", combo: `${a}-${b}`, odds: "12.0", ev_status: "neutral", reason_zh: "順序二重彩：#前者先入", reason_en: "Forecast with leader first" },
        { product: "TRI", combo: [a, b, c].join("-"), odds: "30.0", ev_status: "neutral", reason_zh: "三匹入三甲組合", reason_en: "Trio of top-three candidates" },
      ],
      confidence: 0.62,
      data_freshness: "realtime",
    },
    is_final: Boolean(shouldFinalize),
  };
  return JSON.stringify(example, null, 2);
}

function buildBookieRoundPrompt({
  context,
  transcript,
  roundNo,
  latestUserSeq,
  shouldFinalize,
  validHorseNos,
  newUserMessages,
  previousRuling,
  previousConfidence,
  kellyRelay,
}) {
  const newUserBlock = Array.isArray(newUserMessages) && newUserMessages.length
    ? [
        "",
        "## 本輪新增使用者發言（秘書 Kelly 已回應；你只需設定 user_disposition 與 latest_user_seq，不必逐句代答）",
        buildUserProposalText(newUserMessages),
      ]
    : [];
  const kellyBlock = kellyRelay
    ? [
        "",
        "## 秘書 Kelly 轉達的使用者指令（僅影響你本輪輸出的 directives，即只影響下一輪）",
        kellyRelay,
        "處理規則：合理 → 納入 directives 並在 round_summary_zh 註明「已按使用者指示安排」；不合理 → 在 round_summary_zh 說明不採納原因。",
      ]
    : [];
  const continuityBlock = [];
  if (previousRuling) {
    continuityBlock.push(`你上一輪的裁決：${previousRuling}`);
    continuityBlock.push("若有成員無視此裁決繼續重談，member_verdicts 直接 reject 並在 reason 註明「違反裁決」。");
  }
  if (Number.isFinite(Number(previousConfidence))) {
    continuityBlock.push(
      `你上一輪的 confidence：${Number(previousConfidence)}。本輪必須重新計算；若不變，需在 round_summary_zh 說明原因。`
    );
  }
  return [
    "你是會議主席、首席分析師（Lead Analyst）。請輸出嚴格 JSON，不要 markdown、不要註解、不要多餘文字。",
    shouldFinalize
      ? "目前已達結案條件（距開跑約 1 分鐘），你必須輸出 FINAL 結案版本（is_final=true）。"
      : "你需要主持本輪：評判每位成員、裁決僵持爭議、指派下輪任務，並更新共識 picks。",
    ...continuityBlock,
    "",
    "輸出必須完全符合以下 JSON 結構（欄位名稱、型別一致；以下數值僅為格式示範，內容請依據會議記錄與賽事數據判斷）：",
    buildBookieJsonExample({ validHorseNos, latestUserSeq, shouldFinalize }),
    "",
    `combo 只能使用本場合法馬號：${(validHorseNos ?? []).join(", ") || "(見 RunnersTable)"}。`,
    "qpl 三筆 combo 不可重複。",
    "others 需 4-5 筆、每筆 product 不同，覆蓋至少 4 種產品（WIN/PLA/QIN/FCT/TCE/TRI/FF/QTT/DBL 中挑選）；腳數：WIN/PLA=1、QIN/QPL/DBL/FCT=2、TCE/TRI=3、FF/QTT=4；FCT/TCE/QTT 順序即名次。",
    "member_verdicts 必須涵蓋本輪每位有發言的成員；重複舊內容或空白發言一律 reject。",
    "同一爭議持續兩輪以上必須在 ruling_zh 裁決站邊，並寫明翻案條件；已裁決議題不得重開。",
    "directives 給每位成員的任務要具體到「查哪個數據、答哪個問題」，禁止空泛的「繼續觀察」。",
    "round_summary_zh/en 只寫本輪相對上一輪的變化 + 你的裁決重點；若無變化寫「共識不變」加原因。",
    ...newUserBlock,
    ...kellyBlock,
    "",
    `Current round: ${roundNo}`,
    "",
    "## MeetingTranscript",
    pickRecentTranscript(transcript, 40) || "(empty transcript)",
    "",
    "## RaceContext",
    buildContextText(context),
  ].join("\n");
}

/**
 * One chatroom round: analysts speak in sequence, then bookie summarizes and decides next sequence.
 * @param {{
 *  context: any,
 *  userMessages?: any[],
 *  pendingUserMessages?: any[],
 *  transcript?: any[],
 *  roundNo: number,
 *  sequence?: string[],
 *  latestUserSeq?: number | null,
 *  shouldFinalize?: boolean,
 *  reloadUserMessages?: () => Promise<any[]>,
 *  onEvent?: (type: string, data?: any) => void
 * }} input
 */
export async function runCouncilChatroomRound(input) {
  const {
    context,
    userMessages = [],
    pendingUserMessages = [],
    transcript = [],
    roundNo = 1,
    sequence = COUNCIL_AGENT_ORDER.slice(),
    latestUserSeq = null,
    shouldFinalize = false,
    reloadUserMessages = null,
    chairDirectives = null,
    chairRuling = null,
    previousConfidence = null,
    onEvent,
  } = input;
  const directiveByAgent = new Map();
  for (const d of Array.isArray(chairDirectives) ? chairDirectives : []) {
    const code = String(d?.agent ?? "").trim().toLowerCase();
    const task = String(d?.task_zh ?? d?.task ?? "").trim();
    if (code && task && COUNCIL_AGENT_ORDER.includes(code)) directiveByAgent.set(code, task);
  }
  const emit = async (type, data = {}) => {
    if (typeof onEvent === "function") {
      await onEvent(type, data);
    }
  };

  const seq = normalizeSequence(sequence);
  const workingTranscript = [...(Array.isArray(transcript) ? transcript : [])];
  const analystTurns = [];
  let previousSpeaker = null;

  await emit("chat_round_start", { round_no: roundNo, sequence: seq, should_finalize: shouldFinalize });

  for (let i = 0; i < seq.length; i++) {
    const code = seq[i];
    const agent = COUNCIL_AGENTS[code];
    if (!agent) continue;
    const turnNo = i + 1;
    await emit("chat_turn_start", {
      round_no: roundNo,
      turn_no: turnNo,
      agent_code: code,
      reply_to_speaker: previousSpeaker,
    });
    const prompt = buildAnalystTurnPrompt({
      context,
      userMessages,
      pendingUserMessages,
      transcript: workingTranscript,
      roundNo,
      turnNo,
      speakerCode: code,
      previousSpeaker,
      chairDirective: directiveByAgent.get(code) ?? null,
      chairRuling: chairRuling ?? null,
    });
    const out = await callAgentChat({
      system: agent.system,
      user: prompt,
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
    });
    const turn = {
      round_no: roundNo,
      turn_no: turnNo,
      agent_code: code,
      model: out.model,
      response: out.text,
      usage: out.usage,
      reply_to_speaker: previousSpeaker,
    };
    analystTurns.push(turn);
    workingTranscript.push({
      role: "agent",
      speaker: code,
      round_no: roundNo,
      turn_no: turnNo,
      content: out.text,
    });
    previousSpeaker = code;
    await emit("chat_turn_complete", turn);
  }

  // Re-scan user messages posted while analysts were speaking so the bookie
  // summary reflects the latest user input, not just the round-start snapshot.
  let effectiveLatestUserSeq = Number.isFinite(Number(latestUserSeq)) ? Number(latestUserSeq) : -1;
  let newUserMessages = [];
  if (typeof reloadUserMessages === "function") {
    try {
      const freshUserMessages = (await reloadUserMessages()) ?? [];
      newUserMessages = freshUserMessages.filter((m) => Number(m?.seq ?? -1) > effectiveLatestUserSeq);
      for (const m of newUserMessages) {
        workingTranscript.push({
          role: "user",
          speaker: m.username || `user#${m.user_id ?? "?"}`,
          round_no: roundNo,
          turn_no: 0,
          content: String(m.content ?? "").trim(),
        });
        const seqNum = Number(m?.seq ?? -1);
        if (seqNum > effectiveLatestUserSeq) effectiveLatestUserSeq = seqNum;
      }
    } catch {
      // keep the round-start snapshot if the reload fails
    }
  }

  const validHorseNos = buildValidHorseNos(context);
  // Bookie must address every message the analysts were asked to answer this
  // round: unanswered ones from before the round plus any posted mid-round.
  const unansweredSeen = new Set();
  const unansweredUserMessages = [...(pendingUserMessages ?? []), ...newUserMessages].filter((m) => {
    const s = Number(m?.seq ?? -1);
    if (unansweredSeen.has(s)) return false;
    unansweredSeen.add(s);
    return true;
  });
  // Kelly (secretary) answers the user before the Lead Analyst summarizes.
  // She also relays actionable user instructions to the Lead via a marker line.
  let kellyTurn = null;
  let kellyRelay = "";
  if (unansweredUserMessages.length) {
    const kellyAgent = COUNCIL_AGENTS.kelly;
    const kellyTurnNo = seq.length + 1;
    await emit("chat_turn_start", {
      round_no: roundNo,
      turn_no: kellyTurnNo,
      agent_code: "kelly",
      reply_to_speaker: previousSpeaker,
    });
    try {
      const kellyOut = await callAgentChat({
        system: kellyAgent.system,
        user: buildKellyTurnPrompt({
          context,
          transcript: workingTranscript,
          roundNo,
          userMessages: unansweredUserMessages,
        }),
        model: kellyAgent.model,
        temperature: kellyAgent.temperature,
        max_tokens: kellyAgent.max_tokens,
      });
      const relayMatch = String(kellyOut.text ?? "").match(KELLY_RELAY_RE);
      kellyRelay = relayMatch ? relayMatch[1].trim() : "";
      kellyTurn = {
        round_no: roundNo,
        turn_no: kellyTurnNo,
        agent_code: "kelly",
        model: kellyOut.model,
        response: kellyOut.text,
        usage: kellyOut.usage,
        reply_to_speaker: previousSpeaker,
        relay_to_lead: kellyRelay || null,
      };
      workingTranscript.push({
        role: "agent",
        speaker: "kelly",
        round_no: roundNo,
        turn_no: kellyTurnNo,
        content: kellyOut.text,
      });
      previousSpeaker = "kelly";
      await emit("chat_turn_complete", kellyTurn);
    } catch (err) {
      // Kelly failing must not block the Lead's summary; the Lead still sees
      // the raw user messages in its own prompt block.
      await emit("chat_turn_complete", {
        round_no: roundNo,
        turn_no: kellyTurnNo,
        agent_code: "kelly",
        model: kellyAgent.model,
        response: "（Kelly 暫時離開了座位，稍後回覆～）",
        usage: null,
        reply_to_speaker: previousSpeaker,
        error: String(err?.message ?? err),
      });
    }
  }

  const bookiePrompt = buildBookieRoundPrompt({
    context,
    transcript: workingTranscript,
    roundNo,
    latestUserSeq: effectiveLatestUserSeq,
    shouldFinalize,
    validHorseNos,
    newUserMessages: unansweredUserMessages,
    previousRuling: chairRuling ?? null,
    previousConfidence,
    kellyRelay,
  });

  const bookieTurnNo = seq.length + (kellyTurn ? 2 : 1);
  await emit("chat_bookie_start", {
    round_no: roundNo,
    turn_no: bookieTurnNo,
    agent_code: "bookie",
    should_finalize: shouldFinalize,
  });
  let bookieRaw = await callAgentChat({
    system: COUNCIL_AGENTS.bookie.system,
    user: bookiePrompt,
    model: COUNCIL_AGENTS.bookie.model,
    temperature: COUNCIL_AGENTS.bookie.temperature,
    max_tokens: COUNCIL_AGENTS.bookie.max_tokens,
    jsonMode: true,
  });
  let bookieObj = parseJsonSafe(bookieRaw.text);
  if (!bookieObj) {
    bookieRaw = await callAgentChat({
      system: COUNCIL_AGENTS.bookie.system,
      user: `${bookiePrompt}\n\n[系統] 上一輪 JSON 格式錯誤，請只輸出合法 JSON。`,
      model: COUNCIL_AGENTS.bookie.model,
      temperature: COUNCIL_AGENTS.bookie.temperature,
      max_tokens: COUNCIL_AGENTS.bookie.max_tokens,
      jsonMode: true,
    });
    bookieObj = parseJsonSafe(bookieRaw.text) ?? {};
  }

  const picksParsed = parseCouncilPicks(bookieObj?.current_picks ?? bookieObj?.picks ?? {}, validHorseNos);
  const currentPicks = picksParsed.success ? picksParsed.data : buildFallbackPicks(context);
  const roundSummaryZh = String(bookieObj?.round_summary_zh ?? currentPicks.summary_zh ?? "本輪總結：暫無。").trim();
  const roundSummaryEn = String(bookieObj?.round_summary_en ?? currentPicks.summary_en ?? "Round summary unavailable.").trim();
  // When picks fell back (or lack a summary), reuse the round summary so the
  // consensus card still shows meaningful text instead of a generic notice.
  if (roundSummaryZh && (!picksParsed.success || !String(currentPicks.summary_zh ?? "").trim())) {
    currentPicks.summary_zh = roundSummaryZh;
  }
  if (roundSummaryEn && (!picksParsed.success || !String(currentPicks.summary_en ?? "").trim())) {
    currentPicks.summary_en = roundSummaryEn;
  }
  const nextSequence = normalizeSequence(bookieObj?.next_sequence);
  const userDisposition = normalizeUserDisposition(bookieObj?.user_disposition);
  const isFinal = Boolean(bookieObj?.is_final) || shouldFinalize;

  const memberVerdicts = (Array.isArray(bookieObj?.member_verdicts) ? bookieObj.member_verdicts : [])
    .map((v) => ({
      agent: String(v?.agent ?? "").trim().toLowerCase(),
      verdict: ["adopt", "partial", "reject"].includes(String(v?.verdict ?? "").trim().toLowerCase())
        ? String(v.verdict).trim().toLowerCase()
        : "partial",
      reason_zh: String(v?.reason_zh ?? v?.reason ?? "").trim(),
    }))
    .filter((v) => COUNCIL_AGENT_ORDER.includes(v.agent));
  const rulingZh = String(bookieObj?.ruling_zh ?? "").trim();
  const directives = (Array.isArray(bookieObj?.directives) ? bookieObj.directives : [])
    .map((d) => ({
      agent: String(d?.agent ?? "").trim().toLowerCase(),
      task_zh: String(d?.task_zh ?? d?.task ?? "").trim(),
    }))
    .filter((d) => COUNCIL_AGENT_ORDER.includes(d.agent) && d.task_zh);

  const bookieTurn = {
    round_no: roundNo,
    turn_no: bookieTurnNo,
    agent_code: "bookie",
    model: bookieRaw.model,
    response: bookieRaw.text,
    usage: bookieRaw.usage,
    round_summary_zh: roundSummaryZh,
    round_summary_en: roundSummaryEn,
    member_verdicts: memberVerdicts,
    ruling_zh: rulingZh,
    directives,
    next_sequence: nextSequence,
    user_disposition: userDisposition,
    latest_user_seq: effectiveLatestUserSeq,
    is_final: isFinal,
    picks: {
      ...currentPicks,
      updated_at_utc: toUtcIso(),
      updated_at_hkt: formatHktDateTime(),
    },
  };
  await emit("chat_bookie_complete", bookieTurn);

  return {
    round_no: roundNo,
    sequence: seq,
    analyst_turns: analystTurns,
    kelly_turn: kellyTurn,
    bookie_turn: bookieTurn,
  };
}

export async function runCouncilRound(input) {
  const { context, userMessages = [], onEvent } = input;
  const emit = (type, data = {}) => {
    if (typeof onEvent === "function") onEvent(type, data);
  };

  const stage1User = stage1Prompt(context, userMessages);
  emit("stage1_start");

  const stage1Pairs = await Promise.all(
    COUNCIL_AGENT_ORDER.map(async (code) => {
      const agent = COUNCIL_AGENTS[code];
      const out = await callAgentChat({
        system: agent.system,
        user: stage1User,
        model: agent.model,
        temperature: agent.temperature,
        max_tokens: agent.max_tokens,
      });
      return {
        agent_code: code,
        model: out.model,
        response: out.text,
        usage: out.usage,
      };
    })
  );
  emit("stage1_complete", { stage1: stage1Pairs });

  emit("stage2_start");
  const labels = stage1Pairs.map((_, idx) => `Response ${String.fromCharCode(65 + idx)}`);
  const labelToModel = Object.fromEntries(labels.map((label, idx) => [label, stage1Pairs[idx].model]));
  const anonResponseText = stage1Pairs
    .map((r, idx) => `${labels[idx]}:\n${r.response}`)
    .join("\n\n");
  const stage2User = [
    "Question:",
    `請為 HKJC 投注決策挑選最佳分析回覆。`,
    "",
    "Responses (anonymized):",
    anonResponseText,
    "",
    STAGE2_REVIEW_PROMPT,
  ].join("\n");

  const stage2Pairs = await Promise.all(
    COUNCIL_AGENT_ORDER.map(async (code) => {
      const agent = COUNCIL_AGENTS[code];
      const out = await callAgentChat({
        system: `${agent.system}\n\n你目前是 Stage 2 審稿者，請以英文 ranking labels 輸出 FINAL RANKING。`,
        user: stage2User,
        model: agent.model,
        temperature: Math.max(agent.temperature, 0.1),
        max_tokens: 1200,
      });
      const parsed = parseRankingFromText(out.text);
      return {
        agent_code: code,
        model: out.model,
        ranking: out.text,
        parsed_ranking: parsed,
        usage: out.usage,
      };
    })
  );

  const aggregate_rankings = calculateAggregateRankings(stage2Pairs, labelToModel);
  emit("stage2_complete", { stage2: stage2Pairs, metadata: { label_to_model: labelToModel, aggregate_rankings } });

  emit("stage3_start");
  const stage1Text = stage1Pairs.map((r) => `[${r.agent_code}] ${r.model}\n${r.response}`).join("\n\n");
  const stage2Text = stage2Pairs.map((r) => `[${r.agent_code}] ${r.model}\n${r.ranking}`).join("\n\n");
  const bookiePrompt = [
    "請你作為 Bookie 輸出最終推薦。",
    "你必須輸出嚴格 JSON（不要 markdown）。",
    "需求：qpl 3 筆 + others 2 筆，others 的 product 必須在允許列表。",
    "",
    "### Stage1",
    stage1Text,
    "",
    "### Stage2",
    stage2Text,
    "",
    "### RaceContext",
    buildContextText(context),
  ].join("\n");

  let stage3 = await callAgentChat({
    system: COUNCIL_AGENTS.bookie.system,
    user: bookiePrompt,
    model: COUNCIL_AGENTS.bookie.model,
    temperature: COUNCIL_AGENTS.bookie.temperature,
    max_tokens: COUNCIL_AGENTS.bookie.max_tokens,
    jsonMode: true,
  });

  let parsedObj = null;
  let stage3ParseWarning = null;
  try {
    parsedObj = JSON.parse(stage3.text);
  } catch {
    // retry once with stricter instruction
    stage3 = await callAgentChat({
      system: COUNCIL_AGENTS.bookie.system,
      user: `${bookiePrompt}\n\n[系統] 上一輪 JSON 無法解析，請只輸出合法 JSON。`,
      model: COUNCIL_AGENTS.bookie.model,
      temperature: COUNCIL_AGENTS.bookie.temperature,
      max_tokens: COUNCIL_AGENTS.bookie.max_tokens,
      jsonMode: true,
    });
    try {
      parsedObj = JSON.parse(stage3.text);
    } catch (e) {
      stage3ParseWarning = `Bookie JSON parse failed: ${e?.message ?? String(e)}`;
      parsedObj = {};
    }
  }

  const validHorseNos = buildValidHorseNos(context);
  const parsed = parseCouncilPicks(parsedObj, validHorseNos);
  const parsedData = parsed.success ? parsed.data : buildFallbackPicks(context);
  if (!parsed.success && !stage3ParseWarning) {
    stage3ParseWarning = `Bookie JSON schema mismatch: ${JSON.stringify(parsed.error.flatten()).slice(0, 500)}`;
  }

  const picks = {
    ...parsedData,
    updated_at_utc: toUtcIso(),
    updated_at_hkt: formatHktDateTime(),
  };

  const result = {
    stage1: stage1Pairs,
    stage2: stage2Pairs,
    stage3: {
      model: stage3.model,
      response: stage3.text,
      picks,
      usage: stage3.usage,
      warning: stage3ParseWarning,
    },
    metadata: {
      label_to_model: labelToModel,
      aggregate_rankings,
    },
  };
  emit("stage3_complete", { stage3: result.stage3, metadata: result.metadata });
  return result;
}


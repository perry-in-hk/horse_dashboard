/**
 * HKJC Dashboard — AI analysis prompts (v1).
 * Methodology is informed by general racing analytics ideas (form, market odds, EV-style
 * discussion) and is adapted for HKJC parimutuel pools — not Betfair Exchange.
 * Do not copy large excerpts from third-party prompt libraries; keep text original and short.
 */

export const AI_SYSTEM_PROMPT = `你是協助研究員檢視香港賽馬會（HKJC）賽馬數據的助理；使用者介面為私人儀表板。

規則：
- 賽馬為 HKJC 彩池制（例如獨贏、位置、連贏、位置Q），不是博彩交易所。除非使用者提供的資料中明確包含，否則不要描述孿買孿賣、交易所流動性等。
- 儀表板可能含內部「race_score」（由過往名次與賠率衍生的簡化分數）— 僅作參考，並非馬會或官方評級。
- **你必須在分析中給出「假設職業馬迷會怎樣下註」的具體選項**（馬號＋彩池類型），不能只寫泛論而迴避結論。這是教學／情境模擬用途：仍須聲明賽果無法保證、非個人財務建議，但**要敢於寫明主選與備選**。
- 若資料缺失或過舊，請簡短說明，並在可得範圍內仍盡量給出明確假設性選項（缺 QPL/QIN 數據時，該彩池寫「因快照無此池資料，職業取向從略」即可，但 WIN／PLA 仍須給）。
- **全文必須使用繁體中文**（標題、段落、列表皆然）。使用 Markdown：適度分段、可用項目符號。
- **結構要求（缺一不可）：**
  1. 標題為「## 位置Q（QPL）與連贏（QIN）」的章節：須**以位置Q（QPL）為分析重點**；連贏（QIN）併述。若快照無 QPL／QIN，須說明並提示同步設定 \`ODDS_SYNC_ODDS_TYPES\` 含 QIN、QPL。
  2. 標題為「## 大注資金流追蹤（短時間賠率急跌）」的章節：**僅依**使用者資料中的「Odds momentum」伺服器段落，解讀近時段是否有顯著賠率急跌（教學／情境模擬）；須分開敘述獨贏、位置、位置Q、連贏在此理論下的觀察；資料不足則明說。勿與下一章「職業馬迷」心水混寫成同一列表。
  3. 標題為「## 職業馬迷視角：假設性彩池取向」的獨立章節（**必須放在全文偏後、總結風險提示之前**）。該章節須用條列或表格，**明確寫出**（須有具體馬號，不可用「熱門馬」等模糊詞代替全部）：
     - **獨贏（WIN）**：主選 1 匹（馬號＋馬名）＋必要時備選 1 匹及一句理由。
     - **位置（PLA）**：列出 2～4 匹心水（馬號＋馬名），並標示你認為的穩胆次序（若願意）。
     - **位置Q（QPL）**：至少 1～3 個**具體組合**（例如「5-8」「1-5」格式，對應馬號），並各附一句為何選此組合（可參考賠率與近績）。無數據則註明從略。
     - **連贏（QIN）**：至少 1～3 個**具體組合**（同上）。無數據則註明從略。
     - （可選）其他彩池：如天九、孖寶等—**僅在資料中有提及時**才可寫，否則不要臆測。
  4. 最末用一小段「風險提示」：重申快照時間、臨場變化、以上為假設示範。`;

/**
 * System prompt for JSON-only race analysis (used with OpenAI \`response_format: { type: "json_object" }\`).
 * Pair with \`buildUserPrompt(..., { jsonOutput: true })\`.
 */
export const AI_JSON_SYSTEM_PROMPT = `你是香港賽馬會（HKJC）賽馬數據分析助理。使用者會提供一場賽事的原始資料（馬匹名單、賠率快照、近績表等）。

你必須只輸出**一個 JSON 物件**（不要 Markdown、不要程式碼區塊、不要前後說明文字）。所有敘述字串使用**繁體中文**。

JSON 鍵名與結構必須完全一致如下（值替換為本場真實內容）：

{
  "overview": {
    "raceDateLine": "例如：2026年4月6日",
    "venueLine": "例如：沙田 (ST)",
    "raceNoLine": "例如：第1場",
    "fieldSummary": "參賽馬匹概況（匹數、新馬／初出等）",
    "marketFocus": "市場焦點與大熱／次熱（須含馬號與馬名）",
    "situationSummary": "形勢簡評（一段）"
  },
  "qplQinSection": "此字串為「位置Q與連贏」章節的正文（不含 ## 標題）。須以位置Q（QPL）為重點、連贏（QIN）併述；可用縮排、項目符號。若無 QPL/QIN 快照資料，須說明並可提示設定 ODDS_SYNC_ODDS_TYPES 含 QIN,QPL。",
  "bigMoney": {
    "summary": "一至三句：是否偵測到顯著短時間急跌、觀察時段與快照概況；若無顯著信號亦須說明。僅依「### Odds momentum (server-computed…」段落。",
    "win": "獨贏（WIN）在此理論下：有顯著跌幅時寫馬號／簡述；無則寫為何無法據此理論選馬（勿與職業馬迷主選混成同一套心水列表）。",
    "pla": "位置（PLA）同上，獨立段落。",
    "qpl": "位置Q（QPL）同上；可提組合與跌幅含義。",
    "qin": "連贏（QIN）同上。"
  },
  "proPunter": {
    "introLine": "可選。預設可省略，儀表板會用固定引句；若填則取代預設引句。",
    "win": {
      "main": "主選一行：馬號、馬名、簡短理由",
      "alternate": "備選一行（可選）"
    },
    "pla": [
      "第1匹心水一行（馬號、馬名、註解）",
      "第2匹…",
      "至少 2 行、至多 8 行"
    ],
    "qpl": [
      { "combo": "例如 1-14", "odds": "可選，例如 2.7倍", "reason": "選此組合理由" }
    ],
    "qin": [
      { "combo": "例如 1-14", "odds": "可選", "reason": "選此組合理由" }
    ]
  },
  "riskNotice": "風險提示全文一段：快照時間、臨場變數、新馬不確定性、本分析為假設示範等。"
}

規則：
- bigMoney 五個字串皆須呼應「Odds momentum」伺服器摘要；summary／win／pla／qpl／qin 分開填寫，**不可**併成一段長文塞進單一欄位；每欄用完整句，少用「•」流水帳。資料不足時各欄簡述即可。
- proPunter.win.main 與 pla 陣列須含具體馬號，不可全用「熱門馬」代替。
- qpl／qin 若資料不足可傳空陣列 []，但須在 qplQinSection 說明原因。
- 不要輸出 JSON 以外的任何字元。`;

/**
 * @param {object} ctx
 * @param {{ meeting_date: string, venue_code: string, race_no: number }} ctx.raceKey
 * @param {{ no: number, horse_name: string, horse_code: string }[]} ctx.runners
 * @param {{ source: 'snapshot'|'racecard'|'none', observed_at: string | null, win: Record<string, number>, pla: Record<string, number> }} ctx.oddsSummary
 * @param {{ source: 'snapshot'|'none', observed_at: string | null, qin: { comb: string, odds: number }[], qpl: { comb: string, odds: number }[], qin_truncated?: boolean, qpl_truncated?: boolean }} ctx.pairPools
 * @param {string} [ctx.oddsMomentumBlock] — server-built Odds momentum section (always pass from /analyze)
 * @param {Array<{ horse_code: string, horse_name: string, rows: object[] }>} ctx.formByHorse
 * @param {{ jsonOutput?: boolean }} [opts]
 */
export function buildUserPrompt(ctx, opts = {}) {
  const { raceKey, runners, oddsSummary, pairPools, formByHorse, oddsMomentumBlock } = ctx;
  const header = `## Race context\n- Date: ${raceKey.meeting_date}\n- Venue: ${raceKey.venue_code}\n- Race: ${raceKey.race_no}\n`;

  const runnersBlock = [
    "### Declared runners (racecard)",
    ...runners
      .filter((r) => {
        const no = Number.parseInt(String(r?.no ?? ""), 10);
        return Number.isFinite(no) && no > 0 && !r?.is_standby;
      })
      .map((r) => `- Horse ${r.no}: ${r.horse_name} (${r.horse_code})`),
  ].join("\n");

  let oddsBlock = "### Odds / market snapshot\n_No pool data supplied._\n";
  const hasWin = oddsSummary && Object.keys(oddsSummary.win).length > 0;
  const hasPla = oddsSummary && Object.keys(oddsSummary.pla).length > 0;
  if (oddsSummary && oddsSummary.source !== "none" && (hasWin || hasPla)) {
    const lines = [
      `Source: ${oddsSummary.source}${oddsSummary.observed_at ? ` (observed ${oddsSummary.observed_at})` : ""}`,
    ];
    if (hasWin) {
      lines.push("WIN (horse no → odds):");
      for (const [k, v] of Object.entries(oddsSummary.win)) {
        lines.push(`  - ${k}: ${v}`);
      }
    }
    if (hasPla) {
      lines.push("PLA (horse no → odds):");
      for (const [k, v] of Object.entries(oddsSummary.pla)) {
        lines.push(`  - ${k}: ${v}`);
      }
    }
    oddsBlock = `### Odds / market snapshot\n${lines.join("\n")}\n`;
  }

  let pairBlock = "### QIN / QPL snapshot (連贏 / 位置Q)\n_No QIN or QPL rows in this snapshot._\n";
  if (pairPools && pairPools.source === "snapshot") {
    const qin = pairPools.qin ?? [];
    const qpl = pairPools.qpl ?? [];
    const lines = [
      `Source: snapshot${pairPools.observed_at ? ` (observed ${pairPools.observed_at})` : ""}`,
      "Note: combString is HKJC pair key (e.g. horse numbers). Lower odds ≈ more money on that combination.",
    ];
    if (qpl.length) {
      lines.push("QPL (位置Q) — combination → odds (sorted by odds ascending, favourites first):");
      for (const row of qpl) {
        lines.push(`  - ${row.comb}: ${row.odds}`);
      }
      if (pairPools.qpl_truncated) lines.push("  (...truncated; only top lines shown)");
    } else {
      lines.push("QPL (位置Q): (no rows in snapshot)");
    }
    if (qin.length) {
      lines.push("QIN (連贏) — combination → odds (sorted by odds ascending):");
      for (const row of qin) {
        lines.push(`  - ${row.comb}: ${row.odds}`);
      }
      if (pairPools.qin_truncated) lines.push("  (...truncated; only top lines shown)");
    } else {
      lines.push("QIN (連贏): (no rows in snapshot)");
    }
    pairBlock = `### QIN / QPL snapshot (連贏 / 位置Q)\n${lines.join("\n")}\n`;
  }

  const momentumBlock =
    typeof oddsMomentumBlock === "string" && oddsMomentumBlock.trim()
      ? oddsMomentumBlock.trim() + "\n"
      : "### Odds momentum (server-computed)\n_No momentum block supplied._\n";

  const formBlocks = [];
  for (const h of formByHorse) {
    if (!h.rows.length) {
      formBlocks.push(
        `### Recent form: ${h.horse_name} (${h.horse_code})\n_No prior merged history rows in the database for this horse._`
      );
      continue;
    }
    const lines = [
      `### Recent form: ${h.horse_name} (${h.horse_code})`,
      "| Date | Course | R | Pos | Win odds | draw | race_score (internal) |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    ];
    for (const row of h.rows) {
      lines.push(
        `| ${row.race_date ?? ""} | ${row.racecourse ?? ""} | ${row.race_no ?? ""} | ${row.finish_position ?? ""} | ${row.win_odds ?? ""} | ${row.draw ?? ""} | ${row.race_score ?? ""} |`
      );
    }
    formBlocks.push(lines.join("\n"));
  }

  const body = `${header}\n${runnersBlock}\n\n${oddsBlock}\n\n${pairBlock}\n\n${momentumBlock}\n${formBlocks.join("\n\n")}`;

  if (opts.jsonOutput) {
    return `${body}\n\n---\n請僅根據以上資料，依系統訊息中的 JSON 結構填寫**單一 JSON 物件**（繁體中文），不要輸出 Markdown 全文。`;
  }

  return `${body}\n\n---\n請僅根據以上資料分析本場賽事。**全文請用繁體中文撰寫。**\n\n必須包含：\n1. 「## 位置Q（QPL）與連贏（QIN）」章節（以 QPL 為重點）。\n2. 「## 大注資金流追蹤（短時間賠率急跌）」章節：僅依「Odds momentum」段落解讀短時間急跌；分述 WIN／PLA／QPL／QIN；資料不足則簡述。\n3. 「## 職業馬迷視角：假設性彩池取向」章節：模擬職業馬迷會怎樣選——**獨贏主選／備選、位置心水馬號、QPL 與 QIN 的具體組合（馬號）**，不可只作背景分析而不寫明選項。\n4. 開頭可有簡短賽事概覽；最後附風險提示。`;
}

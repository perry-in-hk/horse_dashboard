import { pool } from "../db.js";
import { settleSession } from "./ai/council/scorecard.js";
import { getMessages } from "./councilService.js";
import { getRaceResultsPayload } from "./raceResultIngest.js";

function asText(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function speakerLabel(meta, role) {
  if (role === "user") {
    const name = asText(meta?.username).trim();
    return name || "User";
  }
  const code = asText(meta?.speaker || meta?.agent_code).trim();
  const map = {
    quant: "Quant",
    historian: "Historian",
    trend: "Trend",
    scout: "Scout",
    kelly: "Kelly",
    bookie: "Lead Analyst",
    system: "System",
  };
  return map[code.toLowerCase()] || code || role || "AI";
}

function formatPicksMarkdown(picks) {
  if (!picks || typeof picks !== "object") return "_尚無共識_\n";
  const lines = [];
  const isFinal = Boolean(picks?._status?.is_final);
  const roundNo = picks?._status?.round_no;
  lines.push(`- 狀態：${isFinal ? "FINAL" : "進行中／最新一版"}`);
  if (roundNo != null) lines.push(`- 回合：${roundNo}`);
  if (picks.confidence != null && Number.isFinite(Number(picks.confidence))) {
    lines.push(`- 信心指數：${Math.round(Math.min(1, Math.max(0, Number(picks.confidence))) * 100)}%`);
  }
  lines.push("");
  const summary = asText(picks.summary_zh || picks.summary_en).trim();
  if (summary) {
    lines.push("### 摘要");
    lines.push("");
    lines.push(summary);
    lines.push("");
  }

  const qpl = Array.isArray(picks.qpl) ? picks.qpl : [];
  lines.push("### 位置 Q 主攻");
  lines.push("");
  if (!qpl.length) {
    lines.push("_無_");
  } else {
    for (const r of qpl) {
      const odds = r.odds ? ` @ ${r.odds}` : "";
      const reason = asText(r.reason_zh || r.reason_en).trim();
      lines.push(`- \`${r.combo}\`${odds}${reason ? ` — ${reason}` : ""}`);
    }
  }
  lines.push("");

  const others = Array.isArray(picks.others) ? picks.others : [];
  lines.push("### 其他彩池");
  lines.push("");
  if (!others.length) {
    lines.push("_無_");
  } else {
    for (const r of others) {
      const product = r.product ? `**${r.product}** ` : "";
      const odds = r.odds ? ` @ ${r.odds}` : "";
      const reason = asText(r.reason_zh || r.reason_en).trim();
      lines.push(`- ${product}\`${r.combo}\`${odds}${reason ? ` — ${reason}` : ""}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function formatResultsMarkdown(payload) {
  const lines = [];
  const status = payload?.status ?? "pending";
  if (status === "unavailable") {
    return "本場無正式賽果（取消／無效）。\n";
  }
  if (!payload?.placings?.length) {
    return status === "pending" ? "賽果尚未寫入資料庫（完賽後會自動抓取）。\n" : "_尚無賽果_\n";
  }

  lines.push("| 名次 | 馬號 | 馬名 | 騎師 | 練馬師 | 賠率 | 時間 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const p of payload.placings) {
    lines.push(
      `| ${p.finish_position ?? ""} | ${p.horse_no ?? ""} | ${p.horse_name ?? ""} | ${p.jockey ?? ""} | ${p.trainer ?? ""} | ${p.win_odds ?? ""} | ${p.finish_time ?? ""} |`
    );
  }
  lines.push("");

  if (payload.dividends?.length) {
    lines.push("### 派彩");
    lines.push("");
    lines.push("| 彩池 | 組合 | 派彩 (HK$) |");
    lines.push("| --- | --- | --- |");
    for (const d of payload.dividends) {
      lines.push(`| ${d.pool ?? ""} | ${d.combination ?? ""} | ${d.payout_hkd ?? ""} |`);
    }
    lines.push("");
  } else if (status === "pending") {
    lines.push("_派彩尚未就緒_");
    lines.push("");
  }
  return lines.join("\n");
}

async function loadFinalOrLatestPicks(sessionId) {
  if (!sessionId) return null;
  const finalQ = await pool.query(
    `SELECT version, picks_json, created_at
     FROM hkjc_council_picks
     WHERE session_id = $1
       AND (picks_json->'_status'->>'is_final') = 'true'
     ORDER BY version DESC
     LIMIT 1`,
    [sessionId]
  );
  if (finalQ.rows[0]) return finalQ.rows[0];
  const latestQ = await pool.query(
    `SELECT version, picks_json, created_at
     FROM hkjc_council_picks
     WHERE session_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [sessionId]
  );
  return latestQ.rows[0] ?? null;
}

async function resolveExportSessionId({ meetingDate, venueCode, raceNo, sessionId }) {
  if (sessionId) {
    const { rows } = await pool.query(
      `SELECT id, status, stop_reason, started_at_utc, stopped_at_utc
       FROM hkjc_council_sessions
       WHERE id = $1
         AND meeting_date = $2::date
         AND venue_code = $3
         AND race_no = $4`,
      [sessionId, meetingDate, venueCode, raceNo]
    );
    return rows[0] ?? null;
  }
  const { rows } = await pool.query(
    `SELECT id, status, stop_reason, started_at_utc, stopped_at_utc
     FROM hkjc_council_sessions
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
     ORDER BY id DESC
     LIMIT 1`,
    [meetingDate, venueCode, raceNo]
  );
  return rows[0] ?? null;
}

/**
 * Build Markdown transcript + final consensus + official results for one session/race.
 */
export async function buildCouncilExportMarkdown({ meetingDate, venueCode, raceNo, sessionId = null }) {
  const session = await resolveExportSessionId({ meetingDate, venueCode, raceNo, sessionId });
  const sid = session ? Number(session.id) : null;

  const messages = sid
    ? await getMessages({
        meetingDate,
        venueCode,
        raceNo,
        sessionId: sid,
        afterSeq: 0,
      })
    : [];

  const picksRow = sid ? await loadFinalOrLatestPicks(sid) : null;
  const picks = picksRow?.picks_json ?? null;
  const results = await getRaceResultsPayload({ meetingDate, venueCode, raceNo });

  const lines = [];
  lines.push(`# AI 議會會議紀錄`);
  lines.push("");
  lines.push(`- 賽馬日：${meetingDate}`);
  lines.push(`- 場地：${venueCode}`);
  lines.push(`- 場次：第 ${raceNo} 場`);
  if (sid) {
    lines.push(`- Session：#${sid}`);
    lines.push(`- 會議狀態：${session.status}${session.stop_reason ? `（${session.stop_reason}）` : ""}`);
  } else {
    lines.push(`- Session：無`);
  }
  lines.push(`- 匯出時間（UTC）：${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## 聊天室訊息`);
  lines.push("");
  if (!messages.length) {
    lines.push("_尚無訊息_");
    lines.push("");
  } else {
    let lastRound = null;
    for (const m of messages) {
      const meta = m.meta_json && typeof m.meta_json === "object" ? m.meta_json : {};
      const roundNo = meta.round_no != null ? Number(meta.round_no) : null;
      if (roundNo && roundNo !== lastRound) {
        lines.push(`### 第 ${roundNo} 輪`);
        lines.push("");
        lastRound = roundNo;
      }
      const who = speakerLabel(meta, m.role);
      const when = m.created_at_hkt ? `${m.created_at_hkt} HKT` : m.created_at_utc || "";
      lines.push(`#### ${who}${when ? ` · ${when}` : ""}`);
      lines.push("");
      lines.push(asText(m.content).trim() || "（空內容）");
      lines.push("");
    }
  }

  lines.push(`## 會議即時共識（FINAL）`);
  lines.push("");
  if (picksRow) {
    lines.push(`- picks version：${picksRow.version}`);
    lines.push("");
  }
  lines.push(formatPicksMarkdown(picks));

  lines.push(`## 正式賽果`);
  lines.push("");
  lines.push(formatResultsMarkdown(results));

  if (sid) {
    lines.push(`## 記分卡`);
    lines.push("");
    try {
      const settled = await settleSession(pool, sid);
      if (!settled || settled.pending) {
        lines.push("_賽果尚未入庫，注單未結算_");
      } else {
        const s = settled.summary ?? {};
        lines.push(`- 放行命中：${s.hits ?? 0}/${s.lines ?? 0}${s.hit_pct != null ? `（${s.hit_pct}%）` : ""}`);
        lines.push(`- 放行單位回報合計：${s.unit_return_sum ?? "—"}`);
        if (s.suggestion?.lines) {
          lines.push(`- 未達最佳：${s.suggestion.hits ?? 0}/${s.suggestion.lines}，不計入放行`);
        }
        lines.push(`- 命中注平均信心：${s.avg_confidence_hit ?? "—"}`);
        lines.push(`- 落空注平均信心：${s.avg_confidence_miss ?? "—"}`);
        lines.push("");
        for (const line of settled.lines ?? []) {
          const ret = line.unit_return == null ? "—" : line.unit_return;
          const tag = line.suggestion ? "未達最佳 " : "";
          lines.push(`- ${tag}${line.product} ${line.combo}：${line.outcome}，下注賠率 ${line.odds_at_pick || "—"}，結算賠率 ${line.closing_odds || "—"}，單位回報 ${ret}`);
        }
      }
    } catch {
      lines.push("_記分卡暫時無法結算_");
    }
    lines.push("");
  }

  return {
    markdown: lines.join("\n"),
    session_id: sid,
    filename: `council-${meetingDate}-${venueCode}-R${raceNo}${sid ? `-s${sid}` : ""}.md`,
  };
}

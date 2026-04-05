import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import {
  fetchMeetingWithRunners,
  fetchRaceRunnersForRace,
} from "../lib/hkjcOddsClient.js";
import {
  AI_JSON_SYSTEM_PROMPT,
  AI_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../lib/ai/prompts.js";
import {
  extractJsonFromMessage,
  parseRaceAnalysisJson,
  renderAnalysisToMarkdown,
} from "../lib/ai/analysisSchema.js";
import { buildOddsMomentumPromptBlock } from "../lib/ai/oddsMomentum.js";
import { MERGED_RACE_FLAT, deriveRaceScore, parsePositionInt } from "./analytics.js";

const router = Router();

const MAX_USER_PROMPT_CHARS = 14000;
const FORM_ROWS_PER_HORSE = 8;
const FOCUS_FORM_ROWS_PER_HORSE = 10;

const analyzeBody = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
  focus_horse_codes: z.array(z.string().min(1)).max(14).optional(),
});

function normalizePoolsPayload(raw) {
  if (raw == null) return [];
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

function parseOddsNum(v) {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * WIN/PLA pools: combString is typically horse number.
 * @returns {{ win: Record<string, number>, pla: Record<string, number> }}
 */
const MAX_PAIR_LINES = 40;

function winPlaFromPmPools(pmPools) {
  const pools = normalizePoolsPayload(pmPools);
  const win = {};
  const pla = {};
  for (const p of pools) {
    const t = String(p.oddsType ?? "").toUpperCase();
    if (t !== "WIN" && t !== "PLA") continue;
    const target = t === "WIN" ? win : pla;
    for (const n of p.oddsNodes ?? []) {
      const comb = String(n.combString ?? "").trim();
      const val = parseOddsNum(n.oddsValue);
      if (!comb || val == null) continue;
      target[comb] = val;
    }
  }
  return { win, pla };
}

/**
 * QIN (連贏) / QPL (位置Q) pair pools from snapshot — sorted by odds ascending, capped for token budget.
 * @returns {{ qin: { comb: string, odds: number }[], qpl: { comb: string, odds: number }[], qin_truncated: boolean, qpl_truncated: boolean }}
 */
function qinQplFromPmPools(pmPools) {
  const pools = normalizePoolsPayload(pmPools);
  const qinRaw = [];
  const qplRaw = [];
  for (const p of pools) {
    const t = String(p.oddsType ?? "").toUpperCase();
    if (t !== "QIN" && t !== "QPL") continue;
    const target = t === "QIN" ? qinRaw : qplRaw;
    for (const n of p.oddsNodes ?? []) {
      const comb = String(n.combString ?? "").trim();
      const val = parseOddsNum(n.oddsValue);
      if (!comb || val == null) continue;
      target.push({ comb, odds: val });
    }
  }
  const byOdds = (a, b) => a.odds - b.odds;
  qinRaw.sort(byOdds);
  qplRaw.sort(byOdds);
  return {
    qin: qinRaw.slice(0, MAX_PAIR_LINES),
    qpl: qplRaw.slice(0, MAX_PAIR_LINES),
    qin_truncated: qinRaw.length > MAX_PAIR_LINES,
    qpl_truncated: qplRaw.length > MAX_PAIR_LINES,
  };
}

function winOddsFromRacecardRace(race) {
  const win = {};
  const pla = {};
  for (const ru of race?.runners ?? []) {
    const no = parseInt(String(ru?.no ?? "").trim(), 10);
    if (!Number.isFinite(no)) continue;
    const key = String(no);
    const w = parseOddsNum(ru?.winOdds);
    if (w != null) win[key] = w;
    const p = parseOddsNum(ru?.placeOdds ?? ru?.plaOdds);
    if (p != null) pla[key] = p;
  }
  return { win, pla };
}

async function loadLatestSnapshotPayload(meetingDate, venueCode, raceNo) {
  const r = await pool.query(
    `SELECT payload, observed_at
     FROM hkjc_odds_snapshots
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
     ORDER BY observed_at DESC
     LIMIT 1`,
    [meetingDate, venueCode, raceNo]
  );
  return r.rows[0] ?? null;
}

async function loadRecentFormRows(horseCodes, capPerHorse) {
  const codes = horseCodes.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return [];

  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT mr.race_date, mr.racecourse, mr.race_no, mr.horse_code, mr.horse_name,
              mr.jockey, mr.trainer, mr.finish_position, mr.finish_time, mr.win_odds, mr.draw,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(mr.horse_code, '')
                ORDER BY COALESCE(mr.race_date, DATE '1900-01-01') DESC, mr.race_no DESC NULLS LAST
              ) AS rn
       FROM (${MERGED_RACE_FLAT}) AS mr
       WHERE mr.horse_code = ANY($1::text[])
     )
     SELECT race_date, racecourse, race_no, horse_code, horse_name, jockey, trainer,
            finish_position, finish_time, win_odds, draw
     FROM ranked WHERE rn <= $2
     ORDER BY horse_code, race_date DESC, race_no DESC NULLS LAST`,
    [codes, capPerHorse]
  );

  return rows.map((row) => {
    const posInt = parsePositionInt(row.finish_position);
    const wo = row.win_odds != null ? Number(row.win_odds) : null;
    return {
      ...row,
      race_score: deriveRaceScore(posInt, wo),
    };
  });
}

function groupFormByHorse(rows, runners) {
  const nameByCode = new Map(runners.map((r) => [r.horse_code.toUpperCase(), r.horse_name]));
  const map = new Map();
  for (const r of rows) {
    const code = r.horse_code?.toUpperCase();
    if (!code) continue;
    if (!map.has(code)) {
      map.set(code, {
        horse_code: code,
        horse_name: nameByCode.get(code) ?? r.horse_name ?? code,
        rows: [],
      });
    }
    map.get(code).rows.push(r);
  }
  for (const ru of runners) {
    const c = ru.horse_code.toUpperCase();
    if (!map.has(c)) {
      map.set(c, { horse_code: c, horse_name: ru.horse_name, rows: [] });
    }
  }
  return runners.map((ru) => map.get(ru.horse_code.toUpperCase()) ?? { horse_code: ru.horse_code, horse_name: ru.horse_name, rows: [] });
}

/**
 * @param {{ system: string, user: string, jsonMode?: boolean }} opts
 */
async function callOpenAIChat(opts) {
  const { system, user, jsonMode = false } = opts;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseRaw = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const base = baseRaw.replace(/\/$/, "");
  const url = `${base}/chat/completions`;

  const body = {
    model,
    temperature: 0.35,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (!res.ok) {
    const err = new Error(`OpenAI HTTP ${res.status}`);
    err.status = res.status === 401 || res.status === 429 ? res.status : 502;
    err.detail = rawText.slice(0, 800);
    throw err;
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error("OpenAI response invalid JSON");
    err.status = 502;
    err.detail = rawText.slice(0, 200);
    throw err;
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    text,
    model: data.model ?? model,
    usage: data.usage ?? null,
  };
}

/** @param {string} content */
function parseStructuredAnalysisFromContent(content) {
  let extracted;
  try {
    extracted = extractJsonFromMessage(content);
  } catch {
    return { ok: false, detail: "empty or invalid message content" };
  }
  let obj;
  try {
    obj = JSON.parse(extracted);
  } catch (e) {
    return { ok: false, detail: `JSON.parse: ${e?.message ?? e}` };
  }
  const r = parseRaceAnalysisJson(obj);
  if (!r.success) {
    const flat = r.error.flatten();
    return { ok: false, detail: JSON.stringify(flat).slice(0, 1200) };
  }
  return { ok: true, data: r.data };
}

/**
 * @param {import("pg").Pool} db
 * @param {{
 *   meeting_date: string,
 *   venue_code: string,
 *   race_no: number,
 *   output_format: string,
 *   markdown_text: string,
 *   structured: object | null,
 *   model: string | undefined,
 *   usage: object | null | undefined,
 *   meta: object,
 * }} p
 * @returns {Promise<number | null>}
 */
async function insertAiAnalysis(db, p) {
  try {
    const r = await db.query(
      `INSERT INTO hkjc_ai_analyses (
         meeting_date, venue_code, race_no, output_format,
         markdown_text, structured_json, model, usage_json, meta_json
       ) VALUES ($1::date, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb)
       RETURNING id`,
      [
        p.meeting_date,
        p.venue_code,
        p.race_no,
        p.output_format,
        p.markdown_text,
        p.structured == null ? null : p.structured,
        p.model ?? null,
        p.usage == null ? null : p.usage,
        p.meta,
      ]
    );
    return r.rows[0]?.id ?? null;
  } catch (e) {
    console.error("[ai] insertAiAnalysis failed:", e?.message ?? e);
    return null;
  }
}

const savedListQuery = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
});

router.get("/saved", async (req, res) => {
  const parsed = savedListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  }
  const { meeting_date, venue_code, race_no, limit } = parsed.data;
  const venue = venue_code.trim();
  const { rows } = await pool.query(
    `SELECT id, created_at, model, output_format
     FROM hkjc_ai_analyses
     WHERE meeting_date = $1::date AND venue_code = $2 AND race_no = $3
     ORDER BY created_at DESC
     LIMIT $4`,
    [meeting_date, venue, race_no, limit]
  );
  res.json({ items: rows });
});

router.get("/saved/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const { rows } = await pool.query(
    `SELECT id, created_at, markdown_text, structured_json, model, usage_json, meta_json
     FROM hkjc_ai_analyses WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: "Saved analysis not found" });
  }
  const meta = row.meta_json && typeof row.meta_json === "object" ? { ...row.meta_json } : {};
  meta.saved_id = row.id;
  meta.saved_at = row.created_at ? new Date(row.created_at).toISOString() : undefined;
  res.json({
    text: row.markdown_text,
    structured: row.structured_json,
    model: row.model,
    usage: row.usage_json,
    meta,
  });
});

router.post("/analyze", async (req, res) => {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return res.status(503).json({ error: "AI analysis is not configured (set OPENAI_API_KEY on the server)." });
  }

  const parsed = analyzeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Bad request", details: parsed.error.flatten() });
  }

  const { meeting_date, venue_code, race_no, focus_horse_codes } = parsed.data;
  const venue = venue_code.trim();

  let runners = await fetchRaceRunnersForRace(meeting_date, venue, race_no);
  if (runners == null || runners.length === 0) {
    return res.status(404).json({ error: "Meeting or race not found, or no runners on the racecard." });
  }

  if (focus_horse_codes?.length) {
    const focus = new Set(focus_horse_codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
    runners = runners.filter((r) => focus.has(r.horse_code.toUpperCase()));
    if (runners.length === 0) {
      return res.status(400).json({ error: "No runners match focus_horse_codes for this race." });
    }
  }

  const snap = await loadLatestSnapshotPayload(meeting_date, venue, race_no);
  let oddsSummary = { source: "none", observed_at: null, win: {}, pla: {} };
  /** @type {{ source: 'snapshot'|'none', observed_at: string | null, qin: object[], qpl: object[], qin_truncated?: boolean, qpl_truncated?: boolean }} */
  let pairPools = { source: "none", observed_at: null, qin: [], qpl: [] };

  if (snap?.payload) {
    const observedAt = snap.observed_at ? new Date(snap.observed_at).toISOString() : null;
    const { win, pla } = winPlaFromPmPools(snap.payload);
    if (Object.keys(win).length || Object.keys(pla).length) {
      oddsSummary = {
        source: "snapshot",
        observed_at: observedAt,
        win,
        pla,
      };
    }
    const qp = qinQplFromPmPools(snap.payload);
    pairPools = {
      source: "snapshot",
      observed_at: observedAt,
      qin: qp.qin,
      qpl: qp.qpl,
      qin_truncated: qp.qin_truncated,
      qpl_truncated: qp.qpl_truncated,
    };
  }

  if (oddsSummary.source === "none") {
    const meeting = await fetchMeetingWithRunners(meeting_date, venue);
    const race = meeting?.races?.find((r) => parseInt(String(r.no), 10) === race_no);
    const { win, pla } = winOddsFromRacecardRace(race);
    if (Object.keys(win).length || Object.keys(pla).length) {
      oddsSummary = { source: "racecard", observed_at: null, win, pla };
    }
  }

  const cap = focus_horse_codes?.length ? FOCUS_FORM_ROWS_PER_HORSE : FORM_ROWS_PER_HORSE;
  const codes = runners.map((r) => r.horse_code);
  const formRows = await loadRecentFormRows(codes, cap);
  const formByHorse = groupFormByHorse(formRows, runners);

  const forceJson = process.env.OPENAI_FORCE_JSON !== "false";

  const oddsMomentumBlock = await buildOddsMomentumPromptBlock(pool, {
    meeting_date,
    venue_code: venue,
    race_no,
  });

  let userPrompt = buildUserPrompt(
    {
      raceKey: { meeting_date, venue_code: venue, race_no },
      runners,
      oddsSummary,
      pairPools,
      oddsMomentumBlock,
      formByHorse,
    },
    { jsonOutput: forceJson }
  );

  if (userPrompt.length > MAX_USER_PROMPT_CHARS) {
    userPrompt =
      userPrompt.slice(0, MAX_USER_PROMPT_CHARS) +
      "\n\n[Context truncated for length; some form rows may be omitted.]";
  }

  try {
    if (forceJson) {
      let out = await callOpenAIChat({
        system: AI_JSON_SYSTEM_PROMPT,
        user: userPrompt,
        jsonMode: true,
      });
      let parsed = parseStructuredAnalysisFromContent(out.text);
      if (!parsed.ok) {
        out = await callOpenAIChat({
          system: AI_JSON_SYSTEM_PROMPT,
          user:
            userPrompt +
            "\n\n[系統] 上一則回覆無法解析為合法 JSON 或欄位不符。請只輸出一個 JSON 物件，鍵名須與系統訊息完全一致，字串內容用繁體中文，不要 Markdown。",
          jsonMode: true,
        });
        parsed = parseStructuredAnalysisFromContent(out.text);
      }
      if (!parsed.ok) {
        return res.status(502).json({
          error: "AI returned invalid JSON",
          detail: parsed.detail,
        });
      }
      const markdown = renderAnalysisToMarkdown(parsed.data);
      const metaJson = {
        meeting_date,
        venue_code: venue,
        race_no,
        odds_source: oddsSummary.source,
        pair_pools_source: pairPools.source,
        qpl_lines: pairPools.qpl?.length ?? 0,
        qin_lines: pairPools.qin?.length ?? 0,
        runners: runners.length,
        output_format: "json_rendered",
      };
      const savedId = await insertAiAnalysis(pool, {
        meeting_date,
        venue_code: venue,
        race_no,
        output_format: "json_rendered",
        markdown_text: markdown,
        structured: parsed.data,
        model: out.model,
        usage: out.usage,
        meta: metaJson,
      });
      return res.json({
        text: markdown,
        structured: parsed.data,
        model: out.model,
        usage: out.usage,
        meta: { ...metaJson, saved_id: savedId ?? undefined },
      });
    }

    const out = await callOpenAIChat({
      system: AI_SYSTEM_PROMPT,
      user: userPrompt,
      jsonMode: false,
    });
    const metaLegacy = {
      meeting_date,
      venue_code: venue,
      race_no,
      odds_source: oddsSummary.source,
      pair_pools_source: pairPools.source,
      qpl_lines: pairPools.qpl?.length ?? 0,
      qin_lines: pairPools.qin?.length ?? 0,
      runners: runners.length,
      output_format: "markdown_legacy",
    };
    const savedIdLegacy = await insertAiAnalysis(pool, {
      meeting_date,
      venue_code: venue,
      race_no,
      output_format: "markdown_legacy",
      markdown_text: out.text,
      structured: null,
      model: out.model,
      usage: out.usage,
      meta: metaLegacy,
    });
    return res.json({
      text: out.text,
      structured: null,
      model: out.model,
      usage: out.usage,
      meta: { ...metaLegacy, saved_id: savedIdLegacy ?? undefined },
    });
  } catch (e) {
    const status = e.status && Number.isFinite(e.status) ? e.status : 502;
    console.error("[ai/analyze] LLM error:", meeting_date, venue, race_no, e?.message ?? e);
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      error: "LLM request failed",
      detail: e.detail ?? (e.message || String(e)),
    });
  }
});

export default router;

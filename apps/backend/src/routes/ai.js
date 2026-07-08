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
import { buildRaceContext } from "../lib/ai/buildRaceContext.js";

const router = Router();

const MAX_USER_PROMPT_CHARS = 14000;
const FORM_ROWS_PER_HORSE = 8;
const FOCUS_FORM_ROWS_PER_HORSE = 10;
const MAX_PAIR_LINES = 40;
const MAX_POOL_LINES = 24;

const analyzeBody = z.object({
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venue_code: z.string().min(1),
  race_no: z.coerce.number().int().positive(),
  focus_horse_codes: z.array(z.string().min(1)).max(14).optional(),
});

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

  const meeting = await fetchMeetingWithRunners(meeting_date, venue);
  const race = meeting?.races?.find((r) => parseInt(String(r.no), 10) === race_no) ?? null;
  const ctx = await buildRaceContext(pool, {
    meeting_date,
    venue_code: venue,
    race_no,
    runners,
    racecardRace: race,
    formRowsPerHorse: FORM_ROWS_PER_HORSE,
    focusFormRowsPerHorse: FOCUS_FORM_ROWS_PER_HORSE,
    focused: Boolean(focus_horse_codes?.length),
    pairLimit: MAX_PAIR_LINES,
    poolLimit: MAX_POOL_LINES,
  });
  const oddsSummary = ctx.oddsSummary;
  const pairPools = ctx.pairPools;
  const formByHorse = ctx.formByHorse;

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

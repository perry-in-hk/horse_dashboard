/**
 * OpenAI-compatible chat call for council agents (DeepSeek compatible via OPENAI_BASE_URL).
 * @param {{
 *  system: string,
 *  user: string,
 *  model: string,
 *  temperature?: number,
 *  max_tokens?: number,
 *  jsonMode?: boolean
 * }} opts
 */
// 2026-07-12 記分卡：獨贏 0/4，輪次與信心上升沒有提高命中。
// 分析師、Kelly、進行中的主席維持 deepseek-flash。
// deepseek-v4-pro 只用於結案那一輪主席。下一個賽馬日若獨贏仍是 0，或信心與命中相反，不要把 Pro 擴大到分析師。
const RETIRED_MODELS = new Set(["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash"]);

export function resolveCouncilModel(model, { finalChair = false } = {}) {
  if (finalChair) return process.env.COUNCIL_MODEL_BOOKIE_FINAL || "deepseek-v4-pro";
  const name = String(model ?? "").trim();
  if (!name || RETIRED_MODELS.has(name)) return process.env.COUNCIL_MODEL_CHAT_FALLBACK || "deepseek-flash";
  return name;
}

export async function callAgentChat(opts) {
  const {
    system,
    user,
    model,
    temperature = 0.2,
    max_tokens = 1000,
    jsonMode = false,
    sharedPrefix = "",
    finalChair = false,
  } = opts;
  const resolvedModel = resolveCouncilModel(model, { finalChair });
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("Missing DEEPSEEK_API_KEY/OPENAI_API_KEY");
    err.status = 503;
    throw err;
  }

  const baseRaw = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const base = baseRaw.replace(/\/$/, "");
  const url = `${base}/chat/completions`;

  const prefix = String(sharedPrefix ?? "").trim();
  const systemContent = prefix ? `${prefix}\n\n${system}` : system;
  const body = {
    model: resolvedModel,
    temperature,
    max_tokens,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: user },
    ],
    // Thinking is off. The API default is on and bills the chain as output tokens.
    thinking: { type: "disabled" },
  };
  if (jsonMode) body.response_format = { type: "json_object" };

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
    const err = new Error(`LLM HTTP ${res.status}`);
    err.status = res.status === 401 || res.status === 429 ? res.status : 502;
    err.detail = rawText.slice(0, 1200);
    throw err;
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error("LLM response invalid JSON");
    err.status = 502;
    err.detail = rawText.slice(0, 500);
    throw err;
  }
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    model: data.model ?? model,
    usage: data.usage ?? null,
  };
}


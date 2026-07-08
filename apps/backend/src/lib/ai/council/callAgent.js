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
export async function callAgentChat(opts) {
  const {
    system,
    user,
    model,
    temperature = 0.2,
    max_tokens = 1000,
    jsonMode = false,
  } = opts;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("Missing DEEPSEEK_API_KEY/OPENAI_API_KEY");
    err.status = 503;
    throw err;
  }

  const baseRaw = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const base = baseRaw.replace(/\/$/, "");
  const url = `${base}/chat/completions`;

  const body = {
    model,
    temperature,
    max_tokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
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


/**
 * LLM client utilities
 *
 * - Centralize LLM calling behavior for scripts under .cursor/scripts
 * - Keep small, dependency-free, and reusable
 */

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function resolveLlmModel({
  explicitModel,
  envLocal,
  envKeys = [],
  defaultModel = "gpt-5.2",
}) {
  if (typeof explicitModel === "string" && explicitModel.trim())
    return explicitModel.trim();

  for (const k of envKeys) {
    const fromProcess = process.env[k];
    if (typeof fromProcess === "string" && fromProcess.trim())
      return fromProcess.trim();

    const fromEnvLocal = envLocal?.[k];
    if (typeof fromEnvLocal === "string" && fromEnvLocal.trim())
      return fromEnvLocal.trim();
  }

  return defaultModel;
}

export function coerceJsonObjectFromModel(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("LLM 回傳為空");

  // direct JSON
  try {
    return JSON.parse(trimmed);
  } catch {}

  // try extract first {...}
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    return JSON.parse(slice);
  }

  throw new Error("無法從 LLM 回傳中解析 JSON");
}

export async function callOpenAiChatCompletions({
  apiKey,
  model,
  messages,
  temperature = 0.2,
  url = "https://api.openai.com/v1/chat/completions",
}) {
  const effectiveApiKey =
    typeof apiKey === "string" && apiKey.trim()
      ? apiKey.trim()
      : (process.env.OPENAI_API_KEY || "").trim();
  if (typeof effectiveApiKey !== "string" || !effectiveApiKey.trim()) {
    throw new Error(
      "缺少 OpenAI API key（請設定 OPENAI_API_KEY 或傳入 apiKey）",
    );
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("缺少 OpenAI model");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages 必須是非空 array");
  }

  const body = {
    model,
    temperature,
    messages,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenAI API 失敗: ${resp.status} ${txt}`.trim());
  }

  return await resp.json();
}

export async function callOpenAiJson({
  apiKey,
  model,
  system,
  input,
  temperature = 0.2,
}) {
  const messages = [
    { role: "system", content: String(system || "") },
    { role: "user", content: JSON.stringify(input) },
  ];

  const data = await callOpenAiChatCompletions({
    apiKey,
    model,
    messages,
    temperature,
  });

  const content = data?.choices?.[0]?.message?.content;
  const obj = coerceJsonObjectFromModel(content);

  if (!isPlainObject(obj)) {
    throw new Error("LLM output 必須是 JSON object");
  }

  return obj;
}

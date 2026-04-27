/**
 * LLM client utilities
 *
 * - Centralize LLM calling behavior for scripts under .cursor/scripts
 * - Keep small, dependency-free, and reusable
 */

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

const DEFAULT_CUSTOM_OPENAI_API_URL =
  "http://service-hub-ai.balinese-python.ts.net/v1";

function normalizeApiDomain(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function resolveChatCompletionsUrl({
  url,
  customOpenAiApiUrl,
  legacyApiDomain,
}) {
  if (typeof url === "string" && url.trim()) {
    return url.trim();
  }

  const explicitDomain = normalizeApiDomain(
    customOpenAiApiUrl || legacyApiDomain || "",
  );
  const envDomain = normalizeApiDomain(
    process.env.CUSTOM_OPENAI_API_URL || "",
  );
  const defaultDomain = DEFAULT_CUSTOM_OPENAI_API_URL;
  const baseDomain = explicitDomain || envDomain || defaultDomain;

  if (baseDomain.endsWith("/chat/completions")) {
    return baseDomain;
  }
  return `${baseDomain}/chat/completions`;
}

function normalizeMessagesForOperatorProxy(messages) {
  const list = Array.isArray(messages) ? messages : [];

  const systemParts = [];
  const contentParts = [];

  for (const m of list) {
    const role = typeof m?.role === "string" ? m.role : "";
    const content =
      typeof m?.content === "string"
        ? m.content
        : m?.content == null
          ? ""
          : safeJsonParse(m.content) != null
            ? JSON.stringify(m.content)
            : String(m.content);

    if (role === "system") systemParts.push(content);
    else contentParts.push(content);
  }

  return {
    system: systemParts.filter(Boolean).join("\n\n"),
    content: contentParts.filter(Boolean).join("\n\n"),
  };
}

async function callCompassOperatorProxy({
  compassApiToken,
  url,
  content,
  system,
  provider = "openai",
  model,
  responseFormat = null,
}) {
  const effectiveCompassApiToken =
    typeof compassApiToken === "string" && compassApiToken.trim()
      ? compassApiToken.trim()
      : (process.env.COMPASS_API_TOKEN || "").trim();

  if (!effectiveCompassApiToken) {
    throw new Error(
      "缺少 COMPASS_API_TOKEN（Compass operator-proxy 需要認證）",
    );
  }

  const effectiveUrl =
    typeof url === "string" && url.trim()
      ? url.trim()
      : process.env.COMPASS_OPERATOR_PROXY_URL ||
        "https://mac09demac-mini.balinese-python.ts.net/api/workflows/operator-proxy";

  const requestBody = {
    content,
    system,
    provider,
    model,
  };
  if (responseFormat && typeof responseFormat === "object") {
    requestBody.response_format = responseFormat;
  }

  const resp = await fetch(effectiveUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": effectiveCompassApiToken,
    },
    body: JSON.stringify(requestBody),
  });

  const rawText = await resp.text().catch(() => "");
  const json = safeJsonParse(rawText);

  if (!resp.ok) {
    const msg =
      (json && typeof json.error === "string" && json.error.trim()) ||
      rawText ||
      resp.statusText ||
      "Unknown error";
    throw new Error(
      `Compass operator-proxy 失敗: ${resp.status} ${msg}`.trim(),
    );
  }

  if (!json || typeof json !== "object") {
    throw new Error("Compass operator-proxy 回傳格式錯誤（非 JSON）");
  }
  if (json.ok !== true) {
    const msg = typeof json.error === "string" ? json.error : "Unknown error";
    throw new Error(`Compass operator-proxy 失敗: ${msg}`.trim());
  }

  return json;
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
  url = null,
  customOpenAiApiUrl = null,
  apiDomain = null,
  responseFormat = null,
  compassApiToken = null,
  compassOperatorProxyUrl = null,
  forceCompassProxy = false,
}) {
  const effectiveApiKey =
    typeof apiKey === "string" && apiKey.trim()
      ? apiKey.trim()
      : (process.env.OPENAI_API_KEY || "").trim();
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("缺少 OpenAI model");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages 必須是非空 array");
  }

  if (forceCompassProxy) {
    const effectiveCompassApiToken =
      typeof compassApiToken === "string" && compassApiToken.trim()
        ? compassApiToken.trim()
        : (process.env.COMPASS_API_TOKEN || "").trim();
    const { system, content } = normalizeMessagesForOperatorProxy(messages);
    const compassResp = await callCompassOperatorProxy({
      compassApiToken: effectiveCompassApiToken,
      url: compassOperatorProxyUrl,
      content,
      system,
      provider: "openai",
      model,
      responseFormat,
    });

<<<<<<< HEAD
    if (effectiveCompassApiToken) {
      const { system, content } = normalizeMessagesForOperatorProxy(messages);
      const compassResp = await callCompassOperatorProxy({
        compassApiToken: effectiveCompassApiToken,
        url: compassOperatorProxyUrl,
        content,
        system,
        provider: "openai",
        model,
        responseFormat,
      });

      const result =
        typeof compassResp?.result === "string" ? compassResp.result : "";
      return {
        choices: [{ message: { content: result } }],
        _provider: "compass",
      };
    }

    throw new Error(
      "缺少 OpenAI API key（請設定 OPENAI_API_KEY 或傳入 apiKey）",
    );
=======
    const result = typeof compassResp?.result === "string" ? compassResp.result : "";
    return {
      choices: [{ message: { content: result } }],
      _provider: "compass",
    };
>>>>>>> 6b375c815a7cd94a006b65489639cd8bad3ced8a
  }

  const effectiveUrl = resolveChatCompletionsUrl({
    url,
    customOpenAiApiUrl,
    legacyApiDomain: apiDomain,
  });

  const body = {
    model,
    temperature,
    messages,
  };
  if (responseFormat && typeof responseFormat === "object") {
    body.response_format = responseFormat;
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (effectiveApiKey) {
    headers.Authorization = `Bearer ${effectiveApiKey}`;
  }

  const resp = await fetch(effectiveUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`LLM API 失敗: ${resp.status} ${txt}`.trim());
  }

  return await resp.json();
}

export async function callOpenAiJson({
  apiKey,
  customOpenAiApiUrl = null,
  apiDomain = null,
  compassApiToken = null,
  compassOperatorProxyUrl = null,
  forceCompassProxy = false,
  model,
  system,
  input,
  temperature = 0.2,
  schema = null,
  schemaName = "structured_output",
}) {
  const messages = [
    { role: "system", content: String(system || "") },
    { role: "user", content: JSON.stringify(input) },
  ];

  let responseFormat = null;
  if (schema && typeof schema === "object") {
    responseFormat = {
      type: "json_schema",
      json_schema: {
        name: String(schemaName || "structured_output"),
        strict: true,
        schema,
      },
    };
  }

  const data = await callOpenAiChatCompletions({
    apiKey,
    customOpenAiApiUrl,
    apiDomain,
    model,
    messages,
    temperature,
    responseFormat,
    compassApiToken,
    compassOperatorProxyUrl,
    forceCompassProxy,
  });

  const content = data?.choices?.[0]?.message?.content;
  const obj = coerceJsonObjectFromModel(content);

  if (!isPlainObject(obj)) {
    throw new Error("LLM output 必須是 JSON object");
  }

  return obj;
}

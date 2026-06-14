/**
 * === 檔案用途區塊 ===
 * @module llm-client
 * @purpose 集中處理 .cursor/scripts 底下的 LLM 呼叫，並支援 Compass operator-proxy 與 custom OpenAI API 網域。
 * @external https://innotech.atlassian.net/browse/FE-8017
 * @external https://innotech.atlassian.net/browse/FE-8138
 * @external https://innotech.atlassian.net/browse/FE-8007
 */

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 安全解析字串為 JSON；失敗時回傳 null。
 * @purpose 用於解析可能的 LLM/Proxy 回傳文字。
 * @external https://innotech.atlassian.net/browse/FE-8017
 */
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

function stripKnownEndpointSuffix(path) {
  return String(path || "").replace(
    /(\/chat\/completions|\/responses|\/completions)$/i,
    "",
  );
}

function resolveApiBaseDomain({
  url,
  customOpenAiApiUrl,
  legacyApiDomain,
}) {
  if (typeof url === "string" && url.trim()) return stripKnownEndpointSuffix(url.trim());

  const explicitDomain = normalizeApiDomain(
    customOpenAiApiUrl || legacyApiDomain || "",
  );
  const envDomain = normalizeApiDomain(
    process.env.CUSTOM_OPENAI_API_URL || "",
  );
  const defaultDomain = DEFAULT_CUSTOM_OPENAI_API_URL;
  return stripKnownEndpointSuffix(explicitDomain || envDomain || defaultDomain);
}

function inferApiKindFromUrl(url) {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) return null;
  if (/\/responses$/i.test(trimmed)) return "responses";
  if (/\/chat\/completions$/i.test(trimmed)) return "chat";
  if (/\/completions$/i.test(trimmed)) return "completions";
  return null;
}

function inferApiKindFromModel(model) {
  const m = String(model || "").toLowerCase();
  if (!m) return "chat";

  // codex 系列模型通常走 v1/responses，比 chat/completions 更穩定
  if (m.includes("codex")) return "responses";

  return "chat";
}

function resolveApiKind({ url, model }) {
  return inferApiKindFromUrl(url) || inferApiKindFromModel(model);
}

function resolveApiUrlForKind({ kind, url, customOpenAiApiUrl, legacyApiDomain }) {
  const explicitKind = inferApiKindFromUrl(url);
  if (explicitKind && typeof url === "string" && url.trim()) return url.trim();

  const baseDomain = resolveApiBaseDomain({ url, customOpenAiApiUrl, legacyApiDomain });
  if (kind === "responses") return `${baseDomain}/responses`;
  if (kind === "completions") return `${baseDomain}/completions`;
  return `${baseDomain}/chat/completions`;
}

function normalizeMessageRoleForResponses(role) {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalized === "assistant") return "assistant";
  if (normalized === "system" || normalized === "developer") return "system";
  return "user";
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (typeof content === "object") return JSON.stringify(content);
  return String(content);
}

function normalizeMessagesForResponses(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => ({
    role: normalizeMessageRoleForResponses(m?.role),
    content: [
      {
        type: "input_text",
        text: normalizeMessageContent(m?.content),
      },
    ],
  }));
}

function convertResponseFormatForResponses(responseFormat) {
  if (!responseFormat || typeof responseFormat !== "object") return null;
  if (
    responseFormat.type === "json_schema" &&
    responseFormat.json_schema &&
    typeof responseFormat.json_schema === "object"
  ) {
    return {
      type: "json_schema",
      ...responseFormat.json_schema,
    };
  }
  return responseFormat;
}

function extractResponsesText(json) {
  if (typeof json?.output_text === "string" && json.output_text) {
    return json.output_text;
  }

  const chunks = [];
  for (const item of Array.isArray(json?.output) ? json.output : []) {
    for (const c of Array.isArray(item?.content) ? item.content : []) {
      if (typeof c?.text === "string" && c.text) chunks.push(c.text);
      else if (typeof c?.output_text === "string" && c.output_text)
        chunks.push(c.output_text);
    }
  }
  return chunks.join("\n");
}

function shouldFallbackToResponses(error) {
  const msg = String(error?.message || "");
  return /v1\/responses|only supported in v1\/responses|not a chat model/i.test(msg);
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

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 決定要使用的 LLM model（依顯式參數、環境變數清單、最後才用預設值）。
 * @purpose 讓呼叫端可用最少設定指定 model。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
export function resolveLlmModel({
  explicitModel,
  envLocal,
  envKeys = [],
  defaultModel = "gpt-5.4-nano",
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

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 由 LLM 回傳文字中取得 JSON 物件（支援純 JSON 或擷取第一個 {...} 區塊）。
 * @purpose 用於結構化輸出後的 JSON 解析。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

    const result =
      typeof compassResp?.result === "string" ? compassResp.result : "";
    return {
      choices: [{ message: { content: result } }],
      _provider: "compass",
    };
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (effectiveApiKey) headers.Authorization = `Bearer ${effectiveApiKey}`;

  const kind = resolveApiKind({ url, model });

  const callChatCompletions = async () => {
    const effectiveUrl = resolveApiUrlForKind({
      kind: "chat",
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
  };

  const callResponses = async () => {
    const effectiveUrl = resolveApiUrlForKind({
      kind: "responses",
      url,
      customOpenAiApiUrl,
      legacyApiDomain: apiDomain,
    });

    const body = {
      model,
      input: normalizeMessagesForResponses(messages),
    };
    if (typeof temperature === "number") body.temperature = temperature;

    const textFormat = convertResponseFormatForResponses(responseFormat);
    if (textFormat) body.text = { format: textFormat };

    const resp = await fetch(effectiveUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`LLM API 失敗: ${resp.status} ${txt}`.trim());
    }

    const json = await resp.json();
    const content = extractResponsesText(json);
    return {
      choices: [{ message: { content } }],
      _endpoint: "responses",
      _raw: json,
    };
  };

  if (kind === "responses") return await callResponses();
  if (kind === "completions") {
    throw new Error("目前 llm-client 尚未支援以 completions endpoint 進行結構化請求");
  }

  try {
    return await callChatCompletions();
  } catch (error) {
    if (shouldFallbackToResponses(error)) {
      return await callResponses();
    }
    throw error;
  }
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 以 LLM 呼叫並強制回傳符合指定 JSON Schema 的物件。
 * @purpose 將 LLM 結構化輸出轉為 JSON object 回傳。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:31:57.607Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 已將檔案/宣告/llm 分析區塊註解調整為三段式格式，並修正宣告區塊的 @external Jira URL 為完整 browse 網址、移除不符合格式/重複的註解；未變更任何 runtime logic。
 */

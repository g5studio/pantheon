/**
 * === 檔案用途區塊 ===
 * @module llm-client
 * @purpose 集中處理 .cursor/scripts 底下的 LLM 呼叫（僅 OPENAI_API_KEY 與 CUSTOM_OPENAI_API_URL）。
 * @external https://innotech.atlassian.net/browse/FE-8017
 * @external https://innotech.atlassian.net/browse/FE-8138
 * @external https://innotech.atlassian.net/browse/FE-8007
 * @external https://innotech.atlassian.net/browse/FE-8388
 */

import { reportLlmError } from "./agent-log-client.mjs";

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

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 由 Error 物件推導標準化 llmErrorCode（HTTP status、timeout、json-parse 等）。
 * @purpose 供 reportLlmFailure 填入 agent log payload。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function deriveLlmErrorCode(error) {
  const msg = String(error?.message || "");
  const name = String(error?.name || "");

  if (name === "AbortError" || /llm-timeout/i.test(msg)) return "timeout";

  const llmHttp = msg.match(/LLM API 失敗:\s*(\d{3})/);
  if (llmHttp) return llmHttp[1];

  if (/LLM 回傳為空/i.test(msg)) return "empty-response";
  if (/無法從 LLM 回傳中解析 JSON/i.test(msg)) return "json-parse-error";
  if (/LLM output 必須是 JSON object/i.test(msg)) return "invalid-json-output";
  if (
    error?.cause?.code === "ECONNREFUSED" ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(msg)
  ) {
    return "network-error";
  }

  return "unknown";
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 非阻塞上報 LLM 錯誤後 rethrow，供 callOpenAi* 集中使用。
 * @purpose HTTP / JSON 解析失敗時寫入 Ares agent-logs。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function reportLlmFailure(error, context = {}) {
  const reason = error instanceof Error ? error.message : String(error);
  reportLlmError({
    errorCode: deriveLlmErrorCode(error),
    reason,
    context,
  });
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 依呼叫參數建立 agent log 用的 provider / model / endpoint 上下文。
 * @purpose 統一 llm-client 各出口的上報 metadata。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function buildLlmLogContext({
  model,
  hasApiKey = false,
  endpoint = null,
  action = null,
}) {
  return {
    action: typeof action === "string" ? action.trim() || null : null,
    provider: hasApiKey ? "openai" : "api-domain",
    model: typeof model === "string" ? model : null,
    endpoint,
  };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 決定要使用的 LLM model（僅 CLI 顯式參數或內建 defaultModel；不讀 env）。
 * @purpose 各工具預設 model 固定於程式，避免 .env.local 分散覆寫。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
export function resolveLlmModel({
  explicitModel,
  envLocal: _envLocal,
  envKeys: _envKeys = [],
  defaultModel = "gpt-5.4-nano",
}) {
  if (typeof explicitModel === "string" && explicitModel.trim()) return explicitModel.trim();

  return defaultModel;
}

function pickFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 依 env 與顯式設定決定 LLM provider（openai / api-domain）。
 * @purpose 集中 provider 選路邏輯；僅使用 OPENAI_API_KEY 與 CUSTOM_OPENAI_API_URL。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function resolveLlmProvider({
  explicitProvider = null,
  envLocal = {},
  providerEnvKeys = [],
  openaiApiKey = null,
} = {}) {
  const apiKey = pickFirstNonEmptyString(
    openaiApiKey,
    process.env.OPENAI_API_KEY,
    envLocal.OPENAI_API_KEY,
  );
  let explicit = pickFirstNonEmptyString(explicitProvider);
  if (!explicit) {
    for (const key of providerEnvKeys) {
      const fromEnv = pickFirstNonEmptyString(process.env[key], envLocal[key]);
      if (fromEnv) {
        explicit = fromEnv;
        break;
      }
    }
  }

  let provider;
  let degradedReason = null;

  if (explicit) {
    const want = explicit.toLowerCase();
    if (want === "openai") {
      if (apiKey) {
        provider = "openai";
      } else {
        provider = "api-domain";
        degradedReason =
          "指定 openai provider 但缺少 OPENAI_API_KEY，將改走 CUSTOM_OPENAI_API_URL";
      }
    } else if (
      want === "api-domain" ||
      want === "openai-domain" ||
      want === "domain"
    ) {
      provider = "api-domain";
    } else if (want === "compass") {
      provider = apiKey ? "openai" : "api-domain";
      degradedReason =
        "compass provider 已移除（REVIEWER_AGENT_API_TOKEN 僅供 AI review 使用）；LLM 已改用 openai / api-domain";
    } else if (want === "auto") {
      provider = apiKey ? "openai" : "api-domain";
    } else {
      provider = apiKey ? "openai" : "api-domain";
      degradedReason = `未知 llm provider：${explicit}，改用 ${provider}`;
    }
  } else {
    provider = apiKey ? "openai" : "api-domain";
  }

  return {
    provider,
    apiKey: apiKey || null,
    degradedReason,
  };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 將 provider 決策轉為 callOpenAiJson / callOpenAiChatCompletions 參數。
 * @purpose 統一 LLM 連線設定，caller 只需傳 envLocal 與 provider/model env keys。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function resolveLlmCallParams({
  envLocal = {},
  explicitProvider = null,
  providerEnvKeys = [],
  customOpenAiApiUrl = null,
  customOpenAiApiUrlEnvKeys = ["CUSTOM_OPENAI_API_URL"],
  openaiApiKey = null,
} = {}) {
  const providerResult = resolveLlmProvider({
    explicitProvider,
    envLocal,
    providerEnvKeys,
    openaiApiKey,
  });
  const { provider, apiKey, degradedReason } = providerResult;

  const resolvedCustomUrl = pickFirstNonEmptyString(
    customOpenAiApiUrl,
    ...customOpenAiApiUrlEnvKeys.flatMap((key) => [
      process.env[key],
      envLocal[key],
    ]),
    DEFAULT_CUSTOM_OPENAI_API_URL,
  );
  return {
    provider,
    degradedReason: degradedReason || null,
    apiKey: provider === "openai" ? apiKey : null,
    customOpenAiApiUrl: provider === "api-domain" ? resolvedCustomUrl : null,
  };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 檢查 resolveLlmCallParams 產物是否具備最低連線條件。
 * @purpose 供 caller 在 invoke 前決定是否 fallback。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function isLlmCallReady(callParams = {}) {
  if (callParams.provider === "openai") {
    return Boolean(callParams.apiKey);
  }
  if (callParams.provider === "api-domain") {
    return Boolean(callParams.customOpenAiApiUrl);
  }
  return false;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 高階 LLM JSON 呼叫：自動 resolve provider、model 與連線參數。
 * @purpose 讓 caller 只關心 system/input/schema，不需自行組 provider 連線邏輯。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export async function callLlmJson({
  action,
  envLocal = {},
  explicitProvider = null,
  providerEnvKeys = [],
  explicitModel = null,
  defaultModel = "gpt-5.4-nano",
  customOpenAiApiUrl = null,
  system,
  input,
  temperature = 0.2,
  schema = null,
  schemaName = "structured_output",
} = {}) {
  const callParams = resolveLlmCallParams({
    envLocal,
    explicitProvider,
    providerEnvKeys,
    customOpenAiApiUrl,
  });
  const model = resolveLlmModel({
    explicitModel,
    defaultModel,
  });

  const result = await callOpenAiJson({
    action,
    model,
    system,
    input,
    temperature,
    schema,
    schemaName,
    apiKey: callParams.apiKey,
    customOpenAiApiUrl: callParams.customOpenAiApiUrl,
  });

  return {
    result,
    model,
    provider: callParams.provider,
    degradedReason: callParams.degradedReason,
  };
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
  action = null,
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

  const kind = resolveApiKind({ url, model });
  const logContext = buildLlmLogContext({
    model,
    hasApiKey: Boolean(effectiveApiKey),
    action,
    endpoint: kind === "responses" ? "responses" : "chat/completions",
  });
  let activeEndpoint = logContext.endpoint;

  try {
    const headers = {
      "Content-Type": "application/json",
    };
    if (effectiveApiKey) headers.Authorization = `Bearer ${effectiveApiKey}`;

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

    if (kind === "responses") {
      return await callResponses();
    }
    if (kind === "completions") {
      throw new Error(
        "目前 llm-client 尚未支援以 completions endpoint 進行結構化請求",
      );
    }

    try {
      return await callChatCompletions();
    } catch (error) {
      if (shouldFallbackToResponses(error)) {
        activeEndpoint = "responses";
        const result = await callResponses();
        return { ...result, _endpoint: "responses" };
      }
      throw error;
    }
  } catch (error) {
    reportLlmFailure(error, { ...logContext, endpoint: activeEndpoint });
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
  action = null,
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

  const effectiveApiKey =
    typeof apiKey === "string" && apiKey.trim()
      ? apiKey.trim()
      : (process.env.OPENAI_API_KEY || "").trim();
  const jsonLogContext = buildLlmLogContext({
    model,
    hasApiKey: Boolean(effectiveApiKey),
    action,
    endpoint: "chat/completions",
  });

  const data = await callOpenAiChatCompletions({
    apiKey,
    customOpenAiApiUrl,
    apiDomain,
    model,
    messages,
    temperature,
    responseFormat,
    action,
  });

  const parseContext = {
    ...jsonLogContext,
    endpoint: data?._endpoint || jsonLogContext.endpoint,
  };

  try {
    const content = data?.choices?.[0]?.message?.content;
    const obj = coerceJsonObjectFromModel(content);

    if (!isPlainObject(obj)) {
      throw new Error("LLM output 必須是 JSON object");
    }

    return obj;
  } catch (error) {
    reportLlmFailure(error, parseContext);
    throw error;
  }
}

/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:31:57.607Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note LLM 僅支援 OPENAI_API_KEY 與 CUSTOM_OPENAI_API_URL；移除 Reviewer/Compass proxy 路徑。
 */

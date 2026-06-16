#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module agent-log-client
 * @purpose 依 env 指定的 Log API 送出 agent log；未設定 env 時關閉功能且不影響主流程。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */

import { basename } from "path";
import {
  getAgentDisplayName,
  getJiraEmail,
  getProjectRoot,
  loadEnvLocal,
} from "../utilities/env-loader.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 安全解析 JSON 字串；失敗回傳 null。
 * @purpose 解析 Log API 回應內容。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從字串候選值中取得第一個非空值。
 * @purpose 合併 process.env 與 .env.local 的 Log API 設定。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function pickFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 Operator Agent Log API 設定（URL）。
 * @purpose 供 sendAgentLog 與 CLI 共用；不假定後端 logger 服務實作。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export function getAgentLogConfig() {
  const envLocal = loadEnvLocal();
  const apiUrl = pickFirstNonEmptyString(
    process.env.OPERATOR_AGENT_LOG_API_URL,
    envLocal.OPERATOR_AGENT_LOG_API_URL,
  );

  return {
    apiUrl,
    enabled: Boolean(apiUrl),
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 判斷自動 agent log 是否已啟用。
 * @purpose 未設定 OPERATOR_AGENT_LOG_API_URL 時回傳 false。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export function isAgentLogEnabled() {
  return getAgentLogConfig().enabled;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 建立 Pantheon 固定格式的 log payload（占位；後續由 Pantheon 擴充欄位）。
 * @purpose 集中定義 log 內容結構，呼叫端可 merge 額外欄位。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export function buildAgentLogPayload(overrides = {}) {
  const base = {};
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    return { ...base, ...overrides };
  }
  return base;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將 log payload 以 `{ data }` 封裝後 POST 至 env 指定的 Log API。
 * @purpose Pantheon 僅負責 HTTP 送出；後端（如 Ares）自行解析 data 並持久化。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export async function sendAgentLog(payload = null) {
  const config = getAgentLogConfig();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: "agent-log-disabled",
    };
  }

  const data =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : buildAgentLogPayload();

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data }),
  });

  const rawText = await response.text().catch(() => "");
  const json = safeJsonParse(rawText);

  if (!response.ok) {
    const message =
      (json && typeof json.error === "string" && json.error.trim()) ||
      rawText ||
      response.statusText ||
      "Unknown error";
    return {
      ok: false,
      skipped: false,
      status: response.status,
      error: message.trim(),
    };
  }

  if (json && typeof json === "object") {
    return {
      ok: json.ok !== false,
      skipped: false,
      status: response.status,
      response: json,
    };
  }

  return {
    ok: true,
    skipped: false,
    status: response.status,
    response: rawText || null,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 建立 LLM 請求失敗時的 log payload（含 userEmail、agentDisplayName、llmErrorCode、reason）。
 * @purpose 供 llm-client 在 HTTP / JSON 解析錯誤時上報 Ares agent-logs。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export function buildLlmErrorLogPayload({ errorCode, reason, context = {} }) {
  const ctx =
    context && typeof context === "object" && !Array.isArray(context)
      ? context
      : {};
  const { provider, model, endpoint, ...rest } = ctx;

  return buildAgentLogPayload({
    agentId: "pantheon-operator",
    action: "llm-error",
    status: "failure",
    projectName: basename(getProjectRoot()),
    userEmail: getJiraEmail() || null,
    agentDisplayName: getAgentDisplayName() || null,
    llmErrorCode: String(errorCode || "unknown"),
    reason: String(reason || "Unknown error"),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...rest,
    occurredAt: new Date().toISOString(),
  });
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 非阻塞上報 LLM 錯誤至 Log API；未設定 URL 或送出失敗時不影響主流程。
 * @purpose llm-client 錯誤 hook 的 fire-and-forget 入口。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export function reportLlmError({ errorCode, reason, context = {} }) {
  if (!isAgentLogEnabled()) return;
  void sendAgentLog(
    buildLlmErrorLogPayload({ errorCode, reason, context }),
  ).catch(() => {});
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-17T00:00:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 新增 buildLlmErrorLogPayload 與 reportLlmError，供 llm-client 上報 LLM 錯誤。
 */

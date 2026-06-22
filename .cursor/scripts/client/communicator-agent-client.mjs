#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module communicator-agent-client
 * @purpose 依 env 對接 Hermes Communicator API 發送 LINE WORKS 通知；僅 URL 未設定時跳過。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getAgentDisplayName,
  getJiraEmail,
  getProjectRoot,
  loadEnvLocal,
} from "../utilities/env-loader.mjs";

const DEFAULT_COMMUNICATOR_AGENT_API_TOKEN =
  "hermes_3Hfh-t54t7eCzZSf8tT2upxKUWPCX3LtERPp64BPD9U";

const ENV_KEY_API_URL = "COMMUNICATOR_AGENT_API_URL";
const ENV_KEY_API_TOKEN = "COMMUNICATOR_AGENT_API_TOKEN";
const ENV_KEY_TARGET = "COMMUNICATOR_AGENT_TARGET";

/**
 * 宣告內容用途說明與單號關聯
 * @description 安全解析 JSON 字串；失敗回傳 null。
 * @purpose 解析 Hermes API 回應內容。
 * @external https://innotech.atlassian.net/browse/FE-8429
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
 * @purpose 合併 process.env 與 .env.local 的 Communicator 設定。
 * @external https://innotech.atlassian.net/browse/FE-8429
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
 * @description 移除 base URL 尾端斜線。
 * @purpose 組裝 Hermes API 完整 endpoint。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 取得 `.cursor/.env.local` 路徑。
 * @purpose 寫回 COMMUNICATOR_AGENT_TARGET 時使用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function getCursorEnvLocalPath() {
  return join(getProjectRoot(), ".cursor", ".env.local");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 更新或追加 `.cursor/.env.local` 中的單一 key。
 * @purpose target 自動解析成功後持久化 lineworks ID。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function upsertCursorEnvLocalKey(key, value) {
  const filePath = getCursorEnvLocalPath();
  const nextLine = `${key}=${value}`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${nextLine}\n`, "utf-8");
    return filePath;
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  let found = false;

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return line;
    const lineKey = trimmed.slice(0, eqIndex).trim();
    if (lineKey !== key) return line;
    found = true;
    return nextLine;
  });

  if (!found) {
    updatedLines.push(nextLine);
  }

  const normalized = updatedLines.join("\n").replace(/\n?$/, "\n");
  writeFileSync(filePath, normalized, "utf-8");
  return filePath;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 Communicator Agent / Hermes API 設定。
 * @purpose 供 send / resolve-target 與 CLI 共用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function getCommunicatorAgentConfig() {
  const envLocal = loadEnvLocal();
  const apiUrl = normalizeBaseUrl(
    pickFirstNonEmptyString(
      process.env[ENV_KEY_API_URL],
      envLocal[ENV_KEY_API_URL],
    ),
  );
  const configuredToken = pickFirstNonEmptyString(
    process.env[ENV_KEY_API_TOKEN],
    envLocal[ENV_KEY_API_TOKEN],
  );
  const target = pickFirstNonEmptyString(
    process.env[ENV_KEY_TARGET],
    envLocal[ENV_KEY_TARGET],
  );

  return {
    apiUrl,
    apiToken: configuredToken || DEFAULT_COMMUNICATOR_AGENT_API_TOKEN,
    target,
    enabled: Boolean(apiUrl),
    usingDefaultToken: !configuredToken,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 判斷 Communicator Agent 是否已啟用。
 * @purpose 僅 COMMUNICATOR_AGENT_API_URL 未設定時回傳 false。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function isCommunicatorAgentEnabled() {
  return getCommunicatorAgentConfig().enabled;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 由 email local part 推導顯示名稱（fallback）。
 * @purpose company-members 無 name 時作為 Hi xxx 的 xxx。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function deriveDisplayNameFromEmail(email) {
  const localPart = String(email || "").split("@")[0]?.trim();
  if (!localPart) return "";

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 組裝通知正文（title / message / url）。
 * @purpose 作為模板中的『正文』區塊。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function buildNotificationBody(title, message, url = "") {
  const safeTitle = String(title || "").trim();
  const safeMessage = String(message || "").trim();
  const safeUrl = String(url || "").trim();
  const head = safeTitle ? `[${safeTitle}] ${safeMessage}`.trim() : safeMessage;
  return safeUrl ? `${head}\n${safeUrl}` : head;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將系統通知格式化為 Operator 訊息模板。
 * @purpose Hi xxx , 我是您的開發助理 [AGENT_DISPLAY_NAME] ，以下訊息通知您：『正文』
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function buildCommunicatorMessage({
  recipientName = "",
  agentDisplayName = "",
  title = "",
  message = "",
  url = "",
} = {}) {
  const body = buildNotificationBody(title, message, url);
  const name = pickFirstNonEmptyString(recipientName) || "there";
  const agentName = pickFirstNonEmptyString(agentDisplayName);
  const assistantIntro = agentName
    ? `我是您的開發助理 ${agentName} ，`
    : "我是您的開發助理，";

  return `Hi ${name} , ${assistantIntro}以下訊息通知您：『${body}』`;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 向 Hermes API 發送 HTTP 請求。
 * @purpose 封裝 Bearer 認證與錯誤解析。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
async function requestHermes(config, path, options = {}) {
  const url = `${config.apiUrl}${path}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await response.text().catch(() => "");
  const json = safeJsonParse(rawText);

  if (!response.ok) {
    const message =
      (json && typeof json.error === "string" && json.error.trim()) ||
      (json &&
        Array.isArray(json.errorMessages) &&
        json.errorMessages.join(", ")) ||
      rawText ||
      response.statusText ||
      "Unknown error";
    return {
      ok: false,
      status: response.status,
      error: String(message).trim(),
      response: json,
    };
  }

  return {
    ok: true,
    status: response.status,
    response: json ?? (rawText || null),
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從 company-members 回應中匹配 JIRA_EMAIL 對應成員。
 * @purpose 取得 lineworks ID 與顯示名稱。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function pickCompanyMemberByEmail(members, email) {
  if (!Array.isArray(members) || members.length === 0) return null;

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedEmail) {
    for (const member of members) {
      const memberEmail = String(member?.email || "")
        .trim()
        .toLowerCase();
      if (memberEmail === normalizedEmail) {
        return member;
      }
    }
  }

  return members[0] ?? null;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 查詢 company-members 取得指定 email 的成員資料。
 * @purpose 解析 target 與 recipient 顯示名稱。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
async function fetchCompanyMemberByEmail(config, email) {
  const query = new URLSearchParams({ email });
  const lookup = await requestHermes(
    config,
    `/api/v1/company-members?${query.toString()}`,
  );
  if (!lookup.ok) return null;
  return pickCompanyMemberByEmail(lookup.response?.members, email);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析通知收件者顯示名稱（Hi xxx 的 xxx）。
 * @purpose 優先使用 company-members.name，fallback 為 email 推導。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export async function resolveRecipientDisplayName(config, email) {
  const member = await fetchCompanyMemberByEmail(config, email);
  const memberName = pickFirstNonEmptyString(member?.name);
  if (memberName) return memberName;

  const derived = deriveDisplayNameFromEmail(email);
  if (derived) return derived;

  return "there";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 以 JIRA_EMAIL 查 Hermes company-members 取得 lineworks target。
 * @purpose COMMUNICATOR_AGENT_TARGET 未設定時自動解析並寫入 .env.local。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export async function resolveCommunicatorTarget(options = {}) {
  const config = getCommunicatorAgentConfig();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: "communicator-disabled",
    };
  }

  if (config.target && !options.forceRefresh) {
    const email = getJiraEmail();
    let recipientName = "";
    if (email) {
      recipientName = await resolveRecipientDisplayName(config, email);
    }

    return {
      ok: true,
      target: config.target,
      source: "env",
      persisted: false,
      recipientName: recipientName || null,
      email: email || null,
    };
  }

  const email = getJiraEmail();
  if (!email) {
    return {
      ok: false,
      skipped: true,
      reason: "missing-jira-email",
    };
  }

  const query = new URLSearchParams({ email });
  const lookup = await requestHermes(
    config,
    `/api/v1/company-members?${query.toString()}`,
  );

  if (!lookup.ok) {
    return {
      ok: false,
      skipped: true,
      reason: "target-resolve-failed",
      error: lookup.error,
      status: lookup.status,
    };
  }

  const members = lookup.response?.members;
  const member = pickCompanyMemberByEmail(members, email);
  const lineworks = pickFirstNonEmptyString(member?.lineworks);
  if (!lineworks) {
    return {
      ok: false,
      skipped: true,
      reason: "target-resolve-failed",
      error: "company-members 回應中找不到 lineworks ID",
    };
  }

  const envPath = upsertCursorEnvLocalKey(ENV_KEY_TARGET, lineworks);
  process.env[ENV_KEY_TARGET] = lineworks;

  return {
    ok: true,
    target: lineworks,
    source: "company-members",
    persisted: true,
    envPath,
    email,
    recipientName:
      pickFirstNonEmptyString(member?.name) ||
      deriveDisplayNameFromEmail(email) ||
      null,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 發送 LINE WORKS 訊息至 Hermes API。
 * @purpose 系統通知雙寫主流程；失敗不 throw。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export async function sendCommunicatorNotification({
  title,
  message,
  url = "",
} = {}) {
  const config = getCommunicatorAgentConfig();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: "communicator-disabled",
    };
  }

  const targetResult = await resolveCommunicatorTarget();
  if (!targetResult.ok || !targetResult.target) {
    return {
      ok: false,
      skipped: true,
      reason: targetResult.reason || "target-resolve-failed",
      error: targetResult.error || null,
    };
  }

  const email = getJiraEmail();
  const recipientName =
    pickFirstNonEmptyString(targetResult.recipientName) ||
    (email ? await resolveRecipientDisplayName(config, email) : "") ||
    "there";

  const payload = {
    target: targetResult.target,
    message: buildCommunicatorMessage({
      recipientName,
      agentDisplayName: getAgentDisplayName() || "",
      title,
      message,
      url,
    }),
  };

  const result = await requestHermes(config, "/api/v1/lineworks/messages", {
    method: "POST",
    body: payload,
  });

  if (!result.ok) {
    return {
      ok: false,
      skipped: false,
      reason: "send-failed",
      status: result.status,
      error: result.error,
      target: targetResult.target,
    };
  }

  return {
    ok: true,
    skipped: false,
    status: result.status,
    target: targetResult.target,
    targetSource: targetResult.source,
    targetPersisted: targetResult.persisted,
    response: result.response,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 非阻塞發送系統通知至 Hermes；未啟用或失敗時不影響主流程。
 * @purpose notify-cursor-rules-failed fire-and-forget 入口。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function reportSystemNotification({ title, message, url = "" } = {}) {
  if (!isCommunicatorAgentEnabled()) return;
  void sendCommunicatorNotification({ title, message, url }).catch(() => {});
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-23T00:00:00.000Z
 * @llm-review-model composer
 * @llm-review-note 調整 Operator 訊息模板：Hi xxx , 我是您的開發助理 [AGENT_DISPLAY_NAME] ，以下訊息通知您：『正文』（FE-8429）。
 */

#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module communicator-agent-client
 * @purpose 依 env 對接 Hermes Communicator API 發送 LINE WORKS 通知；僅 URL 未設定時跳過。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import {
  callLlmJson,
  isLlmCallReady,
  resolveLlmCallParams,
} from "./llm-client.mjs";
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
const ENV_KEY_RETURN_EDITOR = "COMMUNICATOR_RETURN_EDITOR";
const DEFAULT_RETURN_EDITOR = "cursor";

const RETURN_EDITOR_ALIASES = {
  cursor: "cursor",
  vscode: "vscode",
  "visual studio code": "vscode",
  code: "vscode",
  vs: "vscode",
  codex: "codex",
  "claude-code": "claude-code",
  "claude code": "claude-code",
  claude: "claude-code",
  "claude-cli": "claude-code",
  none: "none",
  off: "none",
  false: "none",
  disabled: "none",
};

const NOTIFICATION_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: {
      type: "string",
      description:
        "Status phrase only (Traditional Chinese); contextLabel like [pantheon/FE-8429] is prepended by system",
    },
  },
  required: ["body"],
};

const NOTIFICATION_BODY_SYSTEM_PROMPT = [
  "你是 Pantheon Operator 開發助理，負責為 LINE WORKS 通知「填空」。",
  "",
  "## 訊息模板（固定，不可改寫）",
  "完整訊息會依 input.messageTemplate 組裝，其中 {{body}} 是唯一由你填寫的位置。",
  "範例模板：",
  "Hi FE-William , 我是您的開發助理 Sigrid ，以下訊息通知您： {{body}}",
  "",
  "## 你的任務",
  "- 只產出替換 {{body}} 的短句（繁體中文）。",
  "- 問候語、助理自介、「以下訊息通知您：」已在模板中，body 絕不可重複這些內容。",
  "- body 應簡短（通常一句、10～30 字），像狀態通知，不要寫成完整信件或過度解釋。",
  "",
  "## 填空規則",
  "- input.contextLabel（如 [pantheon/FE-8429]）會由系統自動加在 body 前面，你只需產出後面的「狀態短句」。",
  "- 狀態短句需讓使用者一眼看懂要做什麼（如 Push 已完成、等待指示中、待您確認）。",
  "- 不要重複 contextLabel 中的專案名或 ticket；不要重複問候/助理自介。",
  "- 主要依 input.message 理解狀況；若 message 是英文簡短狀態，轉成自然繁中短句即可。",
  "- 「點擊此處返回」連結由系統依 COMMUNICATOR_RETURN_EDITOR 附加 editor deeplink，你不需要產出 URL。",
  "",
  "## 正確 vs 錯誤範例",
  "contextLabel=[pantheon/FE-8429], message=Push complete",
  "✅ body: Push 已完成",
  "❌ body: [pantheon/FE-8429] Push 已完成（不要含 contextLabel）",
  "",
  "contextLabel=[fluid-two], message=Waiting for instructions",
  "✅ body: 等待指示中",
  "❌ body: Hi FE-William，我是您的開發助理…",
  "",
  '回傳 JSON：{ "body": "..." }',
].join("\n");

/**
 * 宣告內容用途說明與單號關聯
 * @description 組裝通知訊息固定前綴（至「以下訊息通知您： 」為止）。
 * @purpose 供模板預覽與 buildCommunicatorMessage 共用，避免 LLM 填空位置不一致。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function buildCommunicatorMessagePrefix({
  recipientName = "",
  agentDisplayName = "",
} = {}) {
  const name = pickFirstNonEmptyString(recipientName) || "there";
  const agentName = pickFirstNonEmptyString(agentDisplayName);
  const assistantIntro = agentName
    ? `我是您的開發助理 ${agentName} ，`
    : "我是您的開發助理，";

  return `Hi ${name} , ${assistantIntro}以下訊息通知您： `;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產出含 {{body}} 佔位符的完整訊息模板。
 * @purpose 讓 LLM 明確知道填空位置與固定 wrapper。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function buildCommunicatorMessageTemplate({
  recipientName = "",
  agentDisplayName = "",
} = {}) {
  return `${buildCommunicatorMessagePrefix({ recipientName, agentDisplayName })}{{body}}`;
}

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
 * @description 取得目前 git branch 名稱。
 * @purpose 從 branch 推導關聯 Jira ticket。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function getCurrentGitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從 branch 名稱提取 Jira ticket（如 feature/FE-8429）。
 * @purpose 通知正文帶上可辨識的單號上下文。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function extractTicketFromBranch(branch) {
  const match = String(branch || "").match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析通知所需的專案 / branch / ticket 上下文。
 * @purpose 讓 LINE WORKS 訊息可區分哪個專案、哪張單。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function resolveNotificationContext({ title = "" } = {}) {
  const projectName =
    pickFirstNonEmptyString(title, basename(getProjectRoot())) || "unknown";
  const gitBranch = getCurrentGitBranch();
  const ticket = extractTicketFromBranch(gitBranch);

  return {
    projectName,
    gitBranch: gitBranch || null,
    ticket: ticket || null,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產出通知正文前的固定上下文標籤。
 * @purpose 格式如 [pantheon/FE-8429] 或 [pantheon]，供使用者快速辨識。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function formatNotificationContextLabel({
  projectName = "",
  ticket = "",
} = {}) {
  const project = pickFirstNonEmptyString(projectName) || "unknown";
  const ticketId = pickFirstNonEmptyString(ticket);
  return ticketId ? `[${project}/${ticketId}]` : `[${project}]`;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 組裝含上下文標籤的完整通知正文。
 * @purpose contextLabel 由程式固定產生，statusBody 由 LLM 或 fallback 提供。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function assembleNotificationBody(contextLabel, statusBody, url = "") {
  const label = pickFirstNonEmptyString(contextLabel);
  const status = pickFirstNonEmptyString(statusBody);
  const safeUrl = String(url || "").trim();
  const core = [label, status].filter(Boolean).join(" ");
  const withExplicitUrl = safeUrl ? `${core} ${safeUrl}`.trim() : core;
  return finalizeNotificationBody(withExplicitUrl, { explicitUrl: safeUrl }).body;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 正規化專案路徑供 deeplink 使用。
 * @purpose 統一 Windows / macOS 路徑分隔符。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function normalizeProjectPathForDeeplink(projectPath) {
  return String(projectPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產生 cursor:// 開啟 workspace 的 deeplink。
 * @purpose COMMUNICATOR_RETURN_EDITOR=cursor 時使用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function buildCursorWorkspaceDeeplink(projectPath) {
  const encodedPath = encodeURI(normalizeProjectPathForDeeplink(projectPath));
  return encodedPath ? `cursor://file/${encodedPath}` : "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產生 vscode:// 開啟 workspace 的 deeplink。
 * @purpose COMMUNICATOR_RETURN_EDITOR=vscode 時使用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function buildVscodeWorkspaceDeeplink(projectPath) {
  const encodedPath = encodeURI(normalizeProjectPathForDeeplink(projectPath));
  return encodedPath ? `vscode://file/${encodedPath}/` : "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產生 codex:// 開啟 workspace 的 deeplink。
 * @purpose COMMUNICATOR_RETURN_EDITOR=codex 時使用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function buildCodexWorkspaceDeeplink(projectPath) {
  const params = new URLSearchParams();
  params.set("path", String(projectPath || ""));
  return params.toString() ? `codex://threads/new?${params.toString()}` : "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 正規化絕對路徑供 Claude Code deeplink 使用。
 * @purpose claude-cli://open?cwd= 需完整絕對路徑。
 */
function toAbsolutePathForClaudeCode(projectPath) {
  const raw = String(projectPath || "").trim();
  if (!raw) return "";
  return raw.replace(/\\/g, "/");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產生 claude-cli:// 開啟 workspace 的 deeplink。
 * @purpose COMMUNICATOR_RETURN_EDITOR=claude-code 時使用（需 Claude Code v2.1.91+）。
 */
function buildClaudeCodeWorkspaceDeeplink(projectPath) {
  const absolutePath = toAbsolutePathForClaudeCode(projectPath);
  if (!absolutePath) return "";
  const params = new URLSearchParams();
  params.set("cwd", absolutePath);
  return `claude-cli://open?${params.toString()}`;
}

const RETURN_EDITOR_BUILDERS = {
  cursor: { editor: "cursor", build: buildCursorWorkspaceDeeplink },
  vscode: { editor: "vscode", build: buildVscodeWorkspaceDeeplink },
  codex: { editor: "codex", build: buildCodexWorkspaceDeeplink },
  "claude-code": {
    editor: "claude-code",
    build: buildClaudeCodeWorkspaceDeeplink,
  },
};

/**
 * 宣告內容用途說明與單號關聯
 * @description 正規化 COMMUNICATOR_RETURN_EDITOR 設定值。
 * @purpose 統一 alias（如 claude → claude-code）與預設值。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function normalizeReturnEditorKey(raw) {
  if (!pickFirstNonEmptyString(raw)) return DEFAULT_RETURN_EDITOR;
  const normalized = RETURN_EDITOR_ALIASES[String(raw).toLowerCase().trim()];
  return normalized || DEFAULT_RETURN_EDITOR;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析使用者設定的慣用 editor（env）。
 * @purpose 讀取 COMMUNICATOR_RETURN_EDITOR，預設 cursor；none 表示不附加返回連結。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function resolveCommunicatorReturnEditor() {
  const envLocal = loadEnvLocal();
  const raw = pickFirstNonEmptyString(
    process.env[ENV_KEY_RETURN_EDITOR],
    envLocal[ENV_KEY_RETURN_EDITOR],
  );
  return normalizeReturnEditorKey(raw);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依慣用 editor 產生 workspace 返回 deeplink。
 * @purpose 供通知正文末尾「點擊此處返回」使用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function resolveEditorReturnLink(
  projectPath = "",
  editorOverride = "",
) {
  const editorKey = normalizeReturnEditorKey(
    pickFirstNonEmptyString(editorOverride) ||
      pickFirstNonEmptyString(
        process.env[ENV_KEY_RETURN_EDITOR],
        loadEnvLocal()[ENV_KEY_RETURN_EDITOR],
      ),
  );
  if (editorKey === "none") return null;

  const builder = RETURN_EDITOR_BUILDERS[editorKey];
  if (!builder) return null;

  const absolutePath = pickFirstNonEmptyString(projectPath) || getProjectRoot();
  if (!absolutePath) return null;

  const url = builder.build(absolutePath);
  return url ? { url, editor: builder.editor } : null;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 於正文末尾附加「點擊此處返回」editor deeplink。
 * @purpose 讓使用者從 LINE WORKS 一鍵回到慣用 editor workspace。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function appendEditorReturnLink(
  body,
  { projectPath = "", explicitUrl = "", editor = "" } = {},
) {
  const core = String(body || "").trim();
  if (!core || pickFirstNonEmptyString(explicitUrl)) {
    return { body: core, returnLink: null };
  }

  const returnLink = resolveEditorReturnLink(projectPath, editor);
  if (!returnLink?.url) {
    return { body: core, returnLink: null };
  }

  return {
    body: `${core}\n點擊此處返回 ${returnLink.url}`,
    returnLink,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 完成通知正文組裝（含 editor 返回連結）。
 * @purpose 統一 LLM / fallback 輸出後的最終正文格式。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function finalizeNotificationBody(body, { explicitUrl = "" } = {}) {
  return appendEditorReturnLink(body, {
    projectPath: getProjectRoot(),
    explicitUrl,
  });
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
    returnEditor: resolveCommunicatorReturnEditor(),
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
 * @description 組裝通知正文（message / url）；LLM 失敗時的 fallback。
 * @purpose 作為模板中「以下訊息通知您：」後的正文原文直傳。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function buildNotificationBodyFallback(title, message, url = "") {
  const context = resolveNotificationContext({ title });
  const contextLabel = formatNotificationContextLabel(context);
  const safeMessage = String(message || "").trim();
  const safeTitle = String(title || "").trim();
  const statusBody = safeMessage || safeTitle;
  return assembleNotificationBody(contextLabel, statusBody, url);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 以 LLM 理解通知脈絡後擬定正文；失敗時 fallback 原文。
 * @purpose 讓開發助理以繁體中文撰寫 LINE WORKS 通知正文（FE-8429）。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export async function resolveNotificationBodyWithLlm({
  title = "",
  message = "",
  url = "",
  recipientName = "",
} = {}) {
  const context = resolveNotificationContext({ title });
  const contextLabel = formatNotificationContextLabel(context);
  const fallbackBody = buildNotificationBodyFallback(title, message, url);
  const envLocal = loadEnvLocal();
  const callParams = resolveLlmCallParams({
    envLocal,
    providerEnvKeys: ["COMMUNICATOR_LLM_PROVIDER"],
  });

  if (!isLlmCallReady(callParams)) {
    return {
      body: fallbackBody,
      usedLlm: false,
      reason: "llm-credentials-missing",
      context,
      contextLabel,
    };
  }

  const agentDisplayName = getAgentDisplayName() || "";
  const messageTemplate = buildCommunicatorMessageTemplate({
    recipientName,
    agentDisplayName,
  });

  try {
    const { result, model, provider, degradedReason } = await callLlmJson({
      action: "communicator-notification-body",
      envLocal,
      providerEnvKeys: ["COMMUNICATOR_LLM_PROVIDER"],
      defaultModel: "gpt-5.4-nano",
      system: NOTIFICATION_BODY_SYSTEM_PROMPT,
      input: {
        messageTemplate,
        bodyPlaceholder: "{{body}}",
        contextLabel,
        projectName: context.projectName,
        ticket: context.ticket,
        gitBranch: context.gitBranch,
        title: String(title || ""),
        message: String(message || ""),
        url: String(url || ""),
        agentDisplayName,
        recipientName: String(recipientName || ""),
      },
      temperature: 0.3,
      schema: NOTIFICATION_BODY_SCHEMA,
      schemaName: "communicator_notification_body",
    });

    const statusBody = pickFirstNonEmptyString(result?.body);
    if (!statusBody) {
      return {
        body: fallbackBody,
        usedLlm: false,
        reason: "llm-empty-body",
        model,
        llmProvider: provider,
        context,
        contextLabel,
      };
    }

    return {
      body: assembleNotificationBody(contextLabel, statusBody, url),
      statusBody,
      usedLlm: true,
      model,
      llmProvider: provider,
      degradedReason: degradedReason || null,
      context,
      contextLabel,
    };
  } catch (error) {
    return {
      body: fallbackBody,
      usedLlm: false,
      reason: "llm-failed",
      llmProvider: callParams.provider,
      error: error instanceof Error ? error.message : String(error),
      context,
      contextLabel,
    };
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將系統通知格式化為 Operator 訊息模板。
 * @purpose Hi xxx , 我是您的開發助理 [AGENT_DISPLAY_NAME] ，以下訊息通知您： 正文
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function buildCommunicatorMessage({
  recipientName = "",
  agentDisplayName = "",
  title = "",
  message = "",
  url = "",
  body = "",
} = {}) {
  const resolvedBody =
    pickFirstNonEmptyString(body) ||
    buildNotificationBodyFallback(title, message, url);

  return `${buildCommunicatorMessagePrefix({ recipientName, agentDisplayName })}${resolvedBody}`;
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

  const bodyResult = await resolveNotificationBodyWithLlm({
    title,
    message,
    url,
    recipientName,
  });
  const returnLink = pickFirstNonEmptyString(url)
    ? null
    : resolveEditorReturnLink(getProjectRoot());

  const payload = {
    target: targetResult.target,
    message: buildCommunicatorMessage({
      recipientName,
      agentDisplayName: getAgentDisplayName() || "",
      body: bodyResult.body,
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
    message: payload.message,
    body: bodyResult.body,
    statusBody: bodyResult.statusBody || null,
    context: bodyResult.context || null,
    contextLabel: bodyResult.contextLabel || null,
    bodySource: bodyResult.usedLlm ? "llm" : "fallback",
    bodyReason: bodyResult.reason || null,
    bodyError: bodyResult.error || null,
    llmModel: bodyResult.model || null,
    llmProvider: bodyResult.llmProvider || null,
    editorReturnLink: returnLink?.url || null,
    editor: returnLink?.editor || null,
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
 * @llm-review-note FE-8429：COMMUNICATOR_RETURN_EDITOR 新增 claude-code（claude-cli://open?cwd=）。
 */

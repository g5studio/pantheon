#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module prompt-event-client
 * @purpose 組裝並送出 User Prompt Event（logScope=prompt）至 Ares；本階段不依賴 operator session。
 * @external https://innotech.atlassian.net/browse/OL-7
 */

import { createHash } from "crypto";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  buildAgentLogPayload,
  isAgentLogEnabled,
  sendAgentLog,
} from "./agent-log-client.mjs";
import {
  getProjectRoot,
  resolveEnvValue,
} from "../utilities/env-loader.mjs";

const TICKET_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const PRIVACY_MODES = new Set(["preview-hash", "hash-only", "full"]);

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 Prompt Event env（隱私模式、preview 長度、assistant 開關）。
 * @purpose hook collector 與 dry-run 共用設定；不含 operator scope。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function getPromptEventConfig() {
  const enabledRaw = resolveEnvValue("PROMPT_EVENT_ENABLED", {
    required: false,
    label: "PROMPT_EVENT_ENABLED",
  });
  const privacyRaw = String(
    resolveEnvValue("PROMPT_EVENT_PRIVACY_MODE", {
      required: false,
      label: "PROMPT_EVENT_PRIVACY_MODE",
    }) || "preview-hash",
  )
    .trim()
    .toLowerCase();
  const previewRaw = resolveEnvValue("PROMPT_EVENT_PREVIEW_CHARS", {
    required: false,
    label: "PROMPT_EVENT_PREVIEW_CHARS",
  });
  const assistantRaw = resolveEnvValue("PROMPT_EVENT_ASSISTANT_ENABLED", {
    required: false,
    label: "PROMPT_EVENT_ASSISTANT_ENABLED",
  });

  const privacyMode = PRIVACY_MODES.has(privacyRaw) ? privacyRaw : "preview-hash";
  const previewChars = Math.max(
    32,
    Math.min(2000, Number.parseInt(String(previewRaw || "200"), 10) || 200),
  );

  const enabledExplicit =
    enabledRaw == null || String(enabledRaw).trim() === ""
      ? null
      : ["1", "true", "yes", "y"].includes(String(enabledRaw).trim().toLowerCase());

  const assistantEnabled =
    assistantRaw == null || String(assistantRaw).trim() === ""
      ? true
      : ["1", "true", "yes", "y"].includes(String(assistantRaw).trim().toLowerCase());

  return {
    enabled: enabledExplicit === null ? isAgentLogEnabled() : enabledExplicit,
    privacyMode,
    previewChars,
    assistantEnabled,
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function getPromptEventStatePath(projectRoot = getProjectRoot()) {
  return join(projectRoot, ".cursor", "tmp", ".prompt-event-state.json");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取本地 conversation prompt 計數狀態。
 * @purpose 產出 promptIndexInConversation。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function readPromptEventState(projectRoot = getProjectRoot()) {
  const path = getPromptEventStatePath(projectRoot);
  if (!existsSync(path)) return { conversations: {} };
  const parsed = safeJsonParse(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { conversations: {} };
  }
  return {
    conversations:
      parsed.conversations && typeof parsed.conversations === "object"
        ? parsed.conversations
        : {},
  };
}

function writePromptEventState(state, projectRoot = getProjectRoot()) {
  const path = getPromptEventStatePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 遞增 conversation 內 prompt 序號。
 * @purpose 標示同一對話往來順序（不依賴 operator session）。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function bumpPromptIndexInConversation({
  conversationId = "",
  projectRoot = getProjectRoot(),
} = {}) {
  const state = readPromptEventState(projectRoot);
  const key = String(conversationId || "unknown").trim() || "unknown";
  const current = state.conversations[key] || { promptCount: 0 };
  current.promptCount = Number(current.promptCount || 0) + 1;
  state.conversations[key] = current;
  writePromptEventState(state, projectRoot);
  return { promptIndexInConversation: current.promptCount };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從文字擷取第一個 Jira-like ticket。
 * @purpose branch / prompt 推導。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function extractFirstTicket(text) {
  const matches = String(text || "").match(TICKET_REGEX);
  return matches?.[0] || "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從文字擷取所有 ticket（去重）。
 * @purpose relatedTicketsInPrompt。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function extractAllTickets(text) {
  const matches = String(text || "").match(TICKET_REGEX) || [];
  return [...new Set(matches)];
}

function readGitBranch(projectRoot = getProjectRoot()) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依 branch → prompt 正則推導 ticket，並標示來源與信心。
 * @purpose 本階段不含 operator session；無結果時 ticket=null。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function resolveTicketContext({
  promptText = "",
  projectRoot = getProjectRoot(),
} = {}) {
  const branch = readGitBranch(projectRoot);
  const branchTicket = extractFirstTicket(branch);
  if (branchTicket) {
    return {
      ticket: branchTicket,
      ticketSource: "branch",
      ticketConfidence: "medium",
      gitBranch: branch,
    };
  }

  const promptTicket = extractFirstTicket(promptText);
  if (promptTicket) {
    return {
      ticket: promptTicket,
      ticketSource: "prompt-regex",
      ticketConfidence: "low",
      gitBranch: branch || null,
    };
  }

  return {
    ticket: null,
    ticketSource: "none",
    ticketConfidence: "low",
    gitBranch: branch || null,
  };
}

function hashPrompt(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function buildPrivacyFields(promptText, privacyMode, previewChars) {
  const text = String(promptText || "");
  const promptLength = text.length;
  const promptHash = hashPrompt(text);
  const promptPreview =
    text.length <= previewChars ? text : `${text.slice(0, previewChars)}…`;

  if (privacyMode === "full") {
    return {
      promptText: text,
      promptPreview,
      promptHash,
      promptLength,
      privacyMode,
    };
  }

  if (privacyMode === "hash-only") {
    return {
      promptHash,
      promptLength,
      privacyMode,
    };
  }

  return {
    promptPreview,
    promptHash,
    promptLength,
    privacyMode,
  };
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const type = String(item.type || item.attachment_type || "").trim() || null;
      const filePath = String(
        item.file_path || item.filePath || item.path || "",
      ).trim();
      if (!type && !filePath) return null;
      return {
        type,
        filePath: filePath || null,
      };
    })
    .filter(Boolean);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 由 Cursor hook input 組裝 user-prompt / assistant-event payload。
 * @purpose 純 prompt 觀測：logScope=prompt；不含 operator 情境欄位。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function buildPromptEventPayload({
  hookInput = {},
  eventType = "user-prompt",
  projectRoot = getProjectRoot(),
  config = null,
} = {}) {
  const cfg = config || getPromptEventConfig();
  const input =
    hookInput && typeof hookInput === "object" && !Array.isArray(hookInput)
      ? hookInput
      : {};

  const promptText =
    eventType === "assistant-event"
      ? String(input.text || input.prompt || "")
      : String(input.prompt || input.text || "");

  const ticketCtx = resolveTicketContext({ promptText, projectRoot });
  const indexes = bumpPromptIndexInConversation({
    conversationId: input.conversation_id || input.conversationId || "",
    projectRoot,
  });
  const attachments = normalizeAttachments(input.attachments);
  const relatedTicketsInPrompt = extractAllTickets(promptText);
  const privacyFields = buildPrivacyFields(
    promptText,
    cfg.privacyMode,
    cfg.previewChars,
  );
  const occurredAt = new Date().toISOString();

  return buildAgentLogPayload({
    action: "prompt-event",
    category: "prompt-event",
    status: "success",
    reason:
      eventType === "assistant-event"
        ? "assistant response captured"
        : "user prompt captured",
    logScope: "prompt",
    eventType,
    conversationId: input.conversation_id || input.conversationId || null,
    generationId: input.generation_id || input.generationId || null,
    model: input.model || null,
    modelId: input.model_id || input.modelId || null,
    composerMode: input.composer_mode || input.composerMode || null,
    transcriptPath: input.transcript_path || input.transcriptPath || null,
    workspaceRoots: Array.isArray(input.workspace_roots)
      ? input.workspace_roots
      : Array.isArray(input.workspaceRoots)
        ? input.workspaceRoots
        : null,
    attachments,
    attachmentCount: attachments.length,
    relatedTicketsInPrompt,
    ticket: ticketCtx.ticket,
    ticketSource: ticketCtx.ticketSource,
    ticketConfidence: ticketCtx.ticketConfidence,
    ...(ticketCtx.gitBranch ? { gitBranch: ticketCtx.gitBranch } : {}),
    promptIndexInConversation: indexes.promptIndexInConversation,
    occurredAt,
    startedAt: occurredAt,
    durationMs: 0,
    ...privacyFields,
  });
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 送出 prompt-event；未啟用時 skip。
 * @purpose hook collector 短 timeout 入口。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export async function sendPromptEvent(options = {}) {
  const cfg = options.config || getPromptEventConfig();
  if (!cfg.enabled || !isAgentLogEnabled()) {
    return { ok: false, skipped: true, reason: "prompt-event-disabled" };
  }

  if (
    options.eventType === "assistant-event" &&
    cfg.assistantEnabled === false
  ) {
    return { ok: false, skipped: true, reason: "assistant-event-disabled" };
  }

  const payload = buildPromptEventPayload({
    ...options,
    config: cfg,
  });

  return sendAgentLog(payload);
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-14T23:45:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note OL-7 phase1：移除 operator session 依賴，僅保留 hook 可保證欄位與 branch/prompt ticket 推導。
 */

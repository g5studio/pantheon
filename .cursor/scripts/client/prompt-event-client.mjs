#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module prompt-event-client
 * @purpose 組裝並送出 User Prompt Event（logScope=prompt）；prometheus 分支含 operator-session enrichment。
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
import { getProjectRoot } from "../utilities/env-loader.mjs";
import { readOperatorSessionRaw } from "../operator/operator-session.mjs";

const TICKET_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** 寫死預設：不新增 PROMPT_EVENT_* env；僅跟隨既有 Log API URL 啟用。 */
const PROMPT_EVENT_DEFAULTS = {
  privacyMode: "preview-hash",
  previewChars: 200,
  assistantEnabled: true,
  scope: "all",
  operatorEnrichment: true,
};

/**
 * 宣告內容用途說明與單號關聯
 * @description 回傳 Prompt Event 固定設定（無額外 env）。
 * @purpose hook collector 共用；啟用條件僅 MASTER_CONTROL_AGENT_API_URL；prometheus 預設開啟 operator enrichment。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function getPromptEventConfig() {
  return {
    enabled: isAgentLogEnabled(),
    privacyMode: PROMPT_EVENT_DEFAULTS.privacyMode,
    previewChars: PROMPT_EVENT_DEFAULTS.previewChars,
    assistantEnabled: PROMPT_EVENT_DEFAULTS.assistantEnabled,
    scope: PROMPT_EVENT_DEFAULTS.scope,
    operatorEnrichment: PROMPT_EVENT_DEFAULTS.operatorEnrichment,
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
 * @description 讀取本地 prompt 計數狀態。
 * @purpose conversation / operator session 序號。
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
 * @description 遞增 conversation（與可選 operator session）prompt 序號。
 * @purpose promptIndexInConversation / promptIndexInSession。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function bumpPromptIndexes({
  conversationId = "",
  sessionId = "",
  projectRoot = getProjectRoot(),
} = {}) {
  const state = readPromptEventState(projectRoot);
  const key = String(conversationId || "unknown").trim() || "unknown";
  const current = state.conversations[key] || {
    promptCount: 0,
    sessionCounts: {},
  };
  current.promptCount = Number(current.promptCount || 0) + 1;

  let promptIndexInSession = null;
  const sid = String(sessionId || "").trim();
  if (sid) {
    const sessionCounts =
      current.sessionCounts && typeof current.sessionCounts === "object"
        ? current.sessionCounts
        : {};
    sessionCounts[sid] = Number(sessionCounts[sid] || 0) + 1;
    current.sessionCounts = sessionCounts;
    promptIndexInSession = sessionCounts[sid];
  }

  state.conversations[key] = current;
  writePromptEventState(state, projectRoot);

  return {
    promptIndexInConversation: current.promptCount,
    promptIndexInSession,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從文字擷取第一個 Jira-like ticket。
 * @purpose ticket 推導。
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
 * @description 依 session → branch → prompt 推導 ticket。
 * @purpose session 來源標記 high confidence。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function resolveTicketContext({
  session = null,
  promptText = "",
  projectRoot = getProjectRoot(),
} = {}) {
  const sessionTicket = String(session?.ticket || "").trim().toUpperCase();
  if (sessionTicket && /^[A-Z][A-Z0-9]+-\d+$/.test(sessionTicket)) {
    return {
      ticket: sessionTicket,
      ticketSource: "session",
      ticketConfidence: "high",
    };
  }

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

function buildSessionId(session) {
  if (!session || typeof session !== "object") return null;
  const action = String(session.action || "").trim();
  const started = String(session.workflowStartedAt || "").trim();
  if (!action || !started) return null;
  return `${action}@${started}`;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 由 hook input 組裝 prompt-event；固定 merge operator-session 情境欄位。
 * @purpose logScope=prompt；prometheus 寫死開啟 operator enrichment。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
export function buildPromptEventPayload({
  hookInput = {},
  eventType = "user-prompt",
  projectRoot = getProjectRoot(),
  config = null,
  session = undefined,
} = {}) {
  const cfg = config || getPromptEventConfig();
  const input =
    hookInput && typeof hookInput === "object" && !Array.isArray(hookInput)
      ? hookInput
      : {};

  const resolvedSession = cfg.operatorEnrichment
    ? session === undefined
      ? readOperatorSessionRaw()
      : session
    : null;

  const operatorSessionActive = Boolean(resolvedSession?.workflowStartedAt);
  const operatorAction = operatorSessionActive
    ? String(resolvedSession.action || "").trim() || null
    : null;
  const sessionId = buildSessionId(resolvedSession);

  if (cfg.scope === "operator-only" && !operatorSessionActive) {
    return { skipped: true, reason: "scope-operator-only" };
  }

  const promptText =
    eventType === "assistant-event"
      ? String(input.text || input.prompt || "")
      : String(input.prompt || input.text || "");

  const ticketCtx = resolveTicketContext({
    session: resolvedSession,
    promptText,
    projectRoot,
  });

  const indexes = bumpPromptIndexes({
    conversationId: input.conversation_id || input.conversationId || "",
    sessionId: sessionId || "",
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
  const timeSinceSessionStartMs =
    operatorSessionActive && resolvedSession.workflowStartedAt
      ? Math.max(
          0,
          Date.parse(occurredAt) - Date.parse(resolvedSession.workflowStartedAt),
        )
      : null;

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
    ...(cfg.operatorEnrichment
      ? {
          interactionKind: operatorSessionActive ? "operator" : "freeform",
          operatorSessionActive,
          ...(operatorAction ? { operatorAction } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(typeof timeSinceSessionStartMs === "number"
            ? { timeSinceSessionStartMs }
            : {}),
          ...(indexes.promptIndexInSession != null
            ? { promptIndexInSession: indexes.promptIndexInSession }
            : {}),
        }
      : {}),
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
 * @description 送出 prompt-event；未啟用或 scope 略過時 skip。
 * @purpose hook collector 入口。
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

  if (payload?.skipped) {
    return { ok: false, skipped: true, reason: payload.reason };
  }

  return sendAgentLog(payload);
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-15T06:45:00.000Z
 * @llm-review-model cursor-grok
 * @llm-review-note OL-7 phase2：對齊 main，移除 PROMPT_EVENT_* env；寫死 preview-hash/200/assistant/scope=all/enrichment on。
 */

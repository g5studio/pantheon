#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module operator-log
 * @purpose Operator 流程共用的 Ares agent log payload 組裝與送出。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */

import { basename } from "path";
import {
  buildAgentLogPayload,
  isAgentLogEnabled,
  sendAgentLog,
} from "../client/agent-log-client.mjs";
import { getJiraEmail, getProjectRoot } from "../utilities/env-loader.mjs";

const FIX_COMMENT_REVIEW_MODEL = "gpt-5-2025-08-07";

/**
 * 宣告內容用途說明與單號關聯
 * @description 依 status 產出非空的 log reason。
 * @purpose 避免 Ares 前端 reason 欄位空白。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function resolveOperatorLogReason({
  status = "success",
  reason = "",
  action = "operator",
  fallbackReason = "",
} = {}) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed) return trimmed;

  const fallback = typeof fallbackReason === "string" ? fallbackReason.trim() : "";
  if (fallback) return fallback;

  if (status === "success") return `${action} completed`;
  if (status === "cancelled") return `${action} cancelled`;
  return `${action} failed`;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description fix-comment 子命令對應的 review model。
 * @purpose resubmit 時帶入 Ares model 欄位。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function resolveFixCommentModel(command) {
  return command === "resubmit" ? FIX_COMMENT_REVIEW_MODEL : null;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 建立 Operator 固定格式的 log payload。
 * @purpose 補齊 user/userEmail/model/reason，對齊 Ares dashboard。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function buildOperatorAgentLogPayload({
  action,
  category = null,
  status = "success",
  startedAt = null,
  occurredAt = null,
  durationMs = null,
  reason = "",
  fallbackReason = "",
  model = null,
  ...rest
} = {}) {
  if (!action) {
    throw new Error("buildOperatorAgentLogPayload 需要 action");
  }

  const userEmail = getJiraEmail() || null;
  const nowIso = new Date().toISOString();
  const resolvedCategory = category || action;
  const resolvedReason = resolveOperatorLogReason({
    status,
    reason,
    action: resolvedCategory,
    fallbackReason,
  });

  return buildAgentLogPayload({
    agentId: "pantheon-operator",
    action,
    category: resolvedCategory,
    status,
    projectName: basename(getProjectRoot()),
    userEmail,
    user: userEmail,
    ...(model ? { model } : {}),
    reason: resolvedReason,
    startedAt: startedAt || nowIso,
    occurredAt: occurredAt || nowIso,
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...rest,
  });
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 送出 Operator agent log；未設定 API URL 時略過。
 * @purpose 供 operator 腳本與 send-operator-log CLI 共用。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export async function sendOperatorAgentLog(options = {}) {
  if (!isAgentLogEnabled()) {
    return { ok: false, skipped: true, reason: "agent-log-disabled" };
  }
  return sendAgentLog(buildOperatorAgentLogPayload(options));
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-27T00:00:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note FE-8460：Operator log 統一 user/model/reason payload。
 */

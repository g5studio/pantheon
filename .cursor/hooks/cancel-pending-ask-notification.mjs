#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module cancel-pending-ask-notification-hook
 * @purpose Cursor preToolUse / beforeSubmitPrompt hook：使用者已操作時取消 pending 決策通知
 */

import { readFileSync } from "fs";
import { cancelPendingNotification } from "./ask-question-pending.mjs";

const ASK_QUESTION_TOOL_NAMES = new Set([
  "AskQuestion",
  "ask_question",
  "Ask Question",
]);

function readHookInput() {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function isAskQuestionTool(toolName) {
  if (typeof toolName !== "string" || !toolName.trim()) return false;
  const normalized = toolName.trim();
  if (ASK_QUESTION_TOOL_NAMES.has(normalized)) return true;
  return /^askquestion$/i.test(normalized.replace(/[\s_-]+/g, ""));
}

function resolveCwd(input) {
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    return input.cwd.trim();
  }
  if (Array.isArray(input.workspace_roots)) {
    const root = String(input.workspace_roots[0] || "").trim();
    if (root) return root;
  }
  return process.cwd();
}

function main() {
  let input = {};
  try {
    input = readHookInput();
  } catch {
    process.exit(0);
  }

  const cwd = resolveCwd(input);
  const eventName =
    process.argv.includes("--event=beforeSubmitPrompt") ||
    input.hook_event_name === "beforeSubmitPrompt"
      ? "beforeSubmitPrompt"
      : "preToolUse";

  if (eventName === "beforeSubmitPrompt") {
    cancelPendingNotification(cwd, "user-submitted-prompt");
    process.exit(0);
  }

  const toolName = input.tool_name || input.toolName || "";
  if (isAskQuestionTool(toolName)) {
    process.exit(0);
  }

  cancelPendingNotification(cwd, "agent-continued-tool-use");
  process.exit(0);
}

main();

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-23T00:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note resolveCwd 驗證 workspace_roots 非空 trimmed 路徑，避免空 cwd 寫錯 state 檔。
 */

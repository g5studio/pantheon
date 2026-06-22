#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module notify-on-ask-question-hook
 * @purpose Cursor postToolUse hook：AskQuestion 後排程 30 秒冷卻決策通知
 */

import { readFileSync } from "fs";
import { pathToFileURL } from "url";
import {
  scheduleAskQuestionNotification,
  runNotificationScheduler,
} from "./ask-question-pending.mjs";

export {
  buildAskQuestionNotificationMessage,
} from "./notify-on-ask-question-message.mjs";

const ASK_QUESTION_TOOL_NAMES = new Set([
  "AskQuestion",
  "ask_question",
  "Ask Question",
]);

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 Cursor hook stdin JSON payload。
 * @purpose 供 postToolUse 入口解析 AskQuestion 參數。
 */
function readHookInput() {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 判斷 tool_name 是否為 Answer 視窗（AskQuestion）。
 * @purpose 過濾非決策等待類型的 postToolUse 事件。
 */
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
  if (
    Array.isArray(input.workspace_roots) &&
    typeof input.workspace_roots[0] === "string"
  ) {
    return input.workspace_roots[0];
  }
  return process.cwd();
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : "";
}

async function runSchedulerMode() {
  const pendingId = parseArg("pending-id");
  const cwd = parseArg("cwd") || process.cwd();
  if (!pendingId) {
    process.exit(0);
  }
  await runNotificationScheduler({ pendingId, cwd });
}

function runPostToolUseMode() {
  let input = {};
  try {
    input = readHookInput();
  } catch (error) {
    console.error(
      `[notify-on-ask-question] invalid hook input: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(0);
  }

  const toolName = input.tool_name || input.toolName || "";
  if (!isAskQuestionTool(toolName)) {
    process.exit(0);
  }

  const toolInput = input.tool_input || input.toolInput || {};
  const cwd = resolveCwd(input);

  scheduleAskQuestionNotification({ cwd, toolInput });
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--run-scheduler")) {
    await runSchedulerMode();
    return;
  }
  runPostToolUseMode();
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-23T00:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note AskQuestion 通知改為 30 秒冷卻；使用者已操作則由 cancel hook 取消。
 */

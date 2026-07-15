#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module prompt-event-collector-hook
 * @purpose Cursor beforeSubmitPrompt / afterAgentResponse hook：送出 User Prompt Event 至 Ares。
 * @external https://innotech.atlassian.net/browse/OL-7
 */

import { readFileSync } from "fs";
import { sendPromptEvent } from "../scripts/client/prompt-event-client.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 從 stdin 讀取 Cursor hook JSON。
 * @purpose hook 標準輸入契約。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
function readHookInput() {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 hook 事件類型（user-prompt / assistant-event）。
 * @purpose 支援 beforeSubmitPrompt 與 afterAgentResponse。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
function resolveEventType(input, argv) {
  if (
    argv.includes("--event=afterAgentResponse") ||
    input.hook_event_name === "afterAgentResponse"
  ) {
    return "assistant-event";
  }
  return "user-prompt";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 若 hook 帶 workspace_roots，切換 cwd 以對齊專案根目錄。
 * @purpose 讓 operator-session / .env.local 讀取正確路徑。
 * @external https://innotech.atlassian.net/browse/OL-7
 */
function alignCwd(input) {
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    try {
      process.chdir(input.cwd.trim());
      return;
    } catch {
      // ignore
    }
  }
  if (Array.isArray(input.workspace_roots)) {
    const root = String(input.workspace_roots[0] || "").trim();
    if (!root) return;
    try {
      process.chdir(root);
    } catch {
      // ignore
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  let input = {};
  try {
    input = readHookInput();
  } catch {
    process.exit(0);
  }

  try {
    alignCwd(input);
  } catch {
    // ignore
  }

  const eventType = resolveEventType(input, process.argv);

  try {
    if (dryRun) {
      const { buildPromptEventPayload, getPromptEventConfig } = await import(
        "../scripts/client/prompt-event-client.mjs"
      );
      const payload = buildPromptEventPayload({
        hookInput: input,
        eventType,
        config: getPromptEventConfig(),
      });
      console.log(JSON.stringify({ ok: true, dryRun: true, payload }, null, 2));
      process.exit(0);
    }

    const result = await Promise.race([
      sendPromptEvent({ hookInput: input, eventType }),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: false, skipped: true, reason: "timeout" }),
          4500,
        ),
      ),
    ]);

    if (process.env.PROMPT_EVENT_DEBUG === "1") {
      console.error(JSON.stringify(result));
    }
  } catch {
    // 安靜失敗，避免阻斷 Cursor
  }

  process.exit(0);
}

main();

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-14T17:30:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note OL-7：hook 入口送出 prompt-event；失敗安靜退出。
 */

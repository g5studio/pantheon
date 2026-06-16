#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module agent-log
 * @purpose Operator Agent Log CLI：show-config / ping / send。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */

import { existsSync, readFileSync } from "fs";
import {
  buildAgentLogPayload,
  getAgentLogConfig,
  sendAgentLog,
} from "../client/agent-log-client.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 CLI 參數為 key-value map。
 * @purpose 支援 `--action=ping` 格式。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      result[body] = true;
      continue;
    }
    const key = body.slice(0, eqIndex);
    const value = body.slice(eqIndex + 1);
    result[key] = value;
  }
  return result;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 安全解析 JSON 字串。
 * @purpose 解析 `--data` 參數。
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
 * @description 解析 `--data`（inline JSON 或 `@file.json`）；未提供時回傳空 object。
 * @purpose 供 send action 測試用；預設不送出額外欄位。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function parseOptionalDataInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return buildAgentLogPayload();

  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    if (!existsSync(filePath)) {
      throw new Error(`找不到 data 檔案: ${filePath}`);
    }
    const parsed = safeJsonParse(readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`data 檔案必須是 JSON object: ${filePath}`);
    }
    return buildAgentLogPayload(parsed);
  }

  const parsed = safeJsonParse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--data 必須是 JSON object");
  }
  return buildAgentLogPayload(parsed);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 產生 token 預覽字串（避免完整輸出機密）。
 * @purpose 供 show-config 顯示設定狀態。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function maskToken(token) {
  if (typeof token !== "string" || !token.trim()) return null;
  const trimmed = token.trim();
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 印出 CLI 使用說明。
 * @purpose 缺少必要參數時提示使用者。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
function printUsage() {
  console.error(`
Operator Agent Log CLI

Usage:
  pnpm run agent-log -- --action=<action> [options]

Actions:
  show-config   顯示 Log API 設定狀態（不連線）
  ping          送出空 payload（{ data: {} }）測試連線
  send          送出 payload（預設空 object；可選 --data）

Options:
  --data='{"key":"value"}'   send 時的 payload（會 merge 進 Pantheon 固定格式）
  --data=@/path/to/file.json

Env (optional; both required to enable):
  OPERATOR_AGENT_LOG_API_URL
  OPERATOR_AGENT_LOG_API_TOKEN

Examples:
  pnpm run agent-log -- --action=show-config
  pnpm run agent-log -- --action=ping
  pnpm run agent-log -- --action=send
`.trim());
}

/**
 * 宣告內容用途說明與單號關聯
 * @description CLI 主流程。
 * @purpose 提供 show-config / ping / send 操作。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = String(args.action || "").trim().toLowerCase();

  if (!action) {
    printUsage();
    process.exit(1);
  }

  if (action === "show-config") {
    const config = getAgentLogConfig();
    console.log(
      JSON.stringify(
        {
          ok: true,
          enabled: config.enabled,
          apiUrl: config.apiUrl || null,
          apiTokenPreview: maskToken(config.apiToken),
          envKeys: [
            "OPERATOR_AGENT_LOG_API_URL",
            "OPERATOR_AGENT_LOG_API_TOKEN",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  if (action === "ping") {
    const result = await sendAgentLog(buildAgentLogPayload());
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : result.skipped ? 0 : 1);
  }

  if (action === "send") {
    const payload = parseOptionalDataInput(args.data);
    const result = await sendAgentLog(payload);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : result.skipped ? 0 : 1);
  }

  printUsage();
  process.exit(1);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-14T00:00:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 新增 agent-log CLI；預設送出空 data payload，供外部 Log API 對接測試。
 */

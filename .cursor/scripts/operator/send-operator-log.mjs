#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module send-operator-log
 * @purpose Operator 流程結束時送出 Ares agent log（resolve-conflict、fix-comment 收斂等）。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */

import { existsSync, readFileSync } from "fs";
import { sendOperatorAgentLog } from "./operator-log.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 CLI 參數為 key-value map。
 * @purpose 支援 `--action=resolve-conflict` 等格式。
 * @external https://innotech.atlassian.net/browse/FE-8460
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

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function parseOptionalDataInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return {};

  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    if (!existsSync(filePath)) {
      throw new Error(`找不到 data 檔案: ${filePath}`);
    }
    const parsed = safeJsonParse(readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`data 檔案必須是 JSON object: ${filePath}`);
    }
    return parsed;
  }

  const parsed = safeJsonParse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--data 必須是 JSON object");
  }
  return parsed;
}

function parseDurationMs(raw) {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("--duration-ms 必須是非負數字");
  }
  return Math.round(value);
}

function printUsage() {
  console.error(`
Operator Agent Log CLI

Usage:
  node .cursor/scripts/operator/send-operator-log.mjs --action=<action> [options]

Required:
  --action=<name>           例如 resolve-conflict、fix-comment、reverse-engineering

Options:
  --status=success          success | failure | cancelled（預設 success）
  --category=<name>         預設與 action 相同
  --duration-ms=<number>    流程總耗時（毫秒）
  --reason=<text>           結果摘要；成功時若省略會自動產生
  --model=<name>            可選；有 LLM 參與時帶入
  --data='{"key":"value"}'  額外 payload 欄位
  --data=@/path/to/file.json

Examples:
  node .cursor/scripts/operator/send-operator-log.mjs --action=resolve-conflict --duration-ms=120000 --reason="merge completed" --data='{"mergeReport":"..."}'
  node .cursor/scripts/operator/send-operator-log.mjs --action=fix-comment --duration-ms=90000 --reason="comments processed" --data='{"mrUrl":"https://...","resultSummary":"..."}'
`.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = String(args.action || "").trim();
  if (!action) {
    printUsage();
    process.exit(1);
  }

  const status = String(args.status || "success").trim().toLowerCase();
  if (!["success", "failure", "cancelled"].includes(status)) {
    throw new Error("--status 必須是 success、failure 或 cancelled");
  }

  const extra = parseOptionalDataInput(args.data);
  const durationMs = parseDurationMs(args["duration-ms"] ?? args.durationMs);
  const category = String(args.category || action).trim();
  const reason = String(args.reason || "").trim();
  const model = String(args.model || "").trim() || null;

  const result = await sendOperatorAgentLog({
    action,
    category,
    status,
    durationMs: durationMs ?? undefined,
    reason,
    ...(model ? { model } : {}),
    ...extra,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok || result.skipped ? 0 : 1);
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
 * @llm-review-submitted-at 2026-06-27T00:00:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note FE-8460：Operator 流程結束 log CLI，補齊 user/model/reason。
 */

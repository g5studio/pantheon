#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module send-operator-log
 * @purpose Operator 流程結束時送出 Ares agent log（整段 workflow 一筆）；OL-6 自動補 ticket／mrUrl／dataQuality。
 * @external https://innotech.atlassian.net/browse/OL-6
 */

import { existsSync, readFileSync } from "fs";
import {
  resolveFixCommentModel,
  sendOperatorAgentLog,
} from "./operator-log.mjs";
import {
  clearOperatorSession,
  computeWorkflowDurationMs,
  readOperatorSessionForMetrics,
  resolveWorkflowStartedAt,
} from "./operator-session.mjs";
import { buildCollaborationMetrics } from "./operator-collaboration-metrics.mjs";
import {
  resolveWorkflowContractFields,
  warnIdentityGaps,
} from "./operator-workflow-contract.mjs";

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

function parseBooleanFlag(raw, defaultValue = false) {
  if (raw == null || raw === "") return defaultValue;
  if (raw === true) return true;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  throw new Error(`無效的 boolean 參數值: ${raw}`);
}

function resolveWorkflowModel(action, explicitModel) {
  const trimmed = String(explicitModel || "").trim();
  if (trimmed) return trimmed;
  return resolveFixCommentModel(action === "fix-comment" ? "resubmit" : null);
}

function printUsage() {
  console.error(`
Operator Agent Log CLI

Usage:
  node .cursor/scripts/operator/send-operator-log.mjs --action=<action> [options]

Required:
  --action=<name>           例如 resolve-conflict、fix-comment、start-task

Options:
  --status=success          success | failure | cancelled（預設 success）
  --category=<name>         預設與 action 相同
  --started-at=<source>     @session（預設）| @git-notes | ISO 8601
  --duration-ms=<number>    流程總耗時（毫秒）；省略時依 started-at 自動推算
  --reason=<text>           結果摘要；成功時若省略會自動產生
  --model=<name>            可選；fix-comment 預設 gpt-5-2025-08-07
  --clear-session=true      log 成功後清除 session（預設 true）
  --skip-collaboration-metrics=true  略過自動彙整 collaborationMetrics
  --data='{"key":"value"}'  額外 payload 欄位（ticket／mrUrl 可省略，腳本會自動推導）
  --data=@/path/to/file.json

Workflow timing:
  1. 指令入口執行 operator-session --action=start --command=<action> [--ticket=<KEY>]
  2. 流程結尾執行 send-operator-log（省略 duration-ms 時自動從 session 推算）

Contract (OL-6):
  - ticket：explicit --data > session > branch > git-notes > none（寫入 ticketSource）
  - mrUrl：explicit --data > 目前 branch 的 opened MR（最佳努力）
  - start-task 無 plan events 時 collaborationMetrics.planMetrics.missing=true
  - 缺少 JIRA_EMAIL／AGENT_DISPLAY_NAME 時 stderr 警告並寫入 dataQuality

Examples:
  node .cursor/scripts/operator/operator-session.mjs --action=start --command=start-task --ticket=OL-6
  node .cursor/scripts/operator/send-operator-log.mjs --action=start-task --reason="mr created"
  node .cursor/scripts/operator/send-operator-log.mjs --action=fix-comment --reason="comments processed" --data='{"mrUrl":"https://..."}'
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
  const explicitDurationMs = parseDurationMs(args["duration-ms"] ?? args.durationMs);
  const category = String(args.category || action).trim();
  const reason = String(args.reason || "").trim();
  const model = resolveWorkflowModel(action, args.model);
  const clearSession = parseBooleanFlag(
    args["clear-session"] ?? args.clearSession,
    true,
  );
  const skipCollaborationMetrics = parseBooleanFlag(
    args["skip-collaboration-metrics"] ?? args.skipCollaborationMetrics,
    false,
  );

  const occurredAtMs = Date.now();
  const occurredAt = new Date(occurredAtMs).toISOString();
  let startedAt = null;
  let durationMs = explicitDurationMs;
  let startedAtSource = null;

  if (durationMs == null) {
    const startedAtArg = args["started-at"] ?? args.startedAt ?? "@session";
    const resolved = resolveWorkflowStartedAt(startedAtArg, { action });
    startedAt = resolved.startedAt;
    startedAtSource = resolved.source;

    if (
      resolved.sessionAction &&
      resolved.sessionAction !== action &&
      startedAtArg === "@session"
    ) {
      console.warn(
        `⚠️  session action (${resolved.sessionAction}) 與 --action (${action}) 不一致，仍使用 session 起點時間`,
      );
    }

    if (!startedAt) {
      throw new Error(
        "無法推算 durationMs：請先執行 operator-session --action=start --command=<action>，或提供 --started-at / --duration-ms",
      );
    }

    durationMs = computeWorkflowDurationMs(startedAt, occurredAtMs);
  } else if (args["started-at"] || args.startedAt) {
    const resolved = resolveWorkflowStartedAt(args["started-at"] ?? args.startedAt, {
      action,
    });
    startedAt = resolved.startedAt;
    startedAtSource = resolved.source;
  }

  let collaborationMetrics = null;
  let sessionForMetrics = null;
  if (!skipCollaborationMetrics && !extra.collaborationMetrics) {
    sessionForMetrics = readOperatorSessionForMetrics();
    if (sessionForMetrics) {
      // OL-53: buildCollaborationMetrics 為 async（含 LLM 改方向判定）
      collaborationMetrics = await buildCollaborationMetrics(sessionForMetrics, {
        action,
        status,
      });
    }
  } else {
    sessionForMetrics = readOperatorSessionForMetrics();
  }

  warnIdentityGaps({ context: "send-operator-log" });

  const contractFields = resolveWorkflowContractFields({
    explicitTicket: extra.ticket,
    explicitMrUrl: extra.mrUrl,
    session: sessionForMetrics,
    collaborationMetrics:
      collaborationMetrics ||
      (extra.collaborationMetrics && typeof extra.collaborationMetrics === "object"
        ? extra.collaborationMetrics
        : null),
  });

  // explicit --data 仍可覆寫一般欄位；契約欄位以腳本結果為準（ticket／ticketSource／dataQuality）
  const {
    ticket: _ignoredTicket,
    ticketSource: _ignoredTicketSource,
    ticketConfidence: _ignoredTicketConfidence,
    mrUrl: _ignoredMrUrl,
    mrUrlSource: _ignoredMrUrlSource,
    dataQuality: _ignoredDataQuality,
    gitBranch: _ignoredGitBranch,
    ...extraRest
  } = extra;

  const payloadExtra = {
    ...(collaborationMetrics ? { collaborationMetrics } : {}),
    ...extraRest,
    ticket: contractFields.ticket,
    ticketSource: contractFields.ticketSource,
    ticketConfidence: contractFields.ticketConfidence,
    ...(contractFields.gitBranch ? { gitBranch: contractFields.gitBranch } : {}),
    ...(contractFields.mrUrl ? { mrUrl: contractFields.mrUrl } : {}),
    mrUrlSource: contractFields.mrUrlSource,
    dataQuality: contractFields.dataQuality,
  };

  const result = await sendOperatorAgentLog({
    action,
    category,
    status,
    ...(startedAt ? { startedAt } : {}),
    occurredAt,
    durationMs: durationMs ?? undefined,
    reason,
    ...(model ? { model } : {}),
    ...(startedAtSource ? { startedAtSource } : {}),
    logScope: "workflow",
    ...payloadExtra,
  });

  const output = {
    ...result,
    timing: {
      startedAt,
      occurredAt,
      durationMs,
      startedAtSource,
      durationSource: explicitDurationMs == null ? "computed" : "explicit",
    },
    contract: {
      ticket: contractFields.ticket,
      ticketSource: contractFields.ticketSource,
      ticketConfidence: contractFields.ticketConfidence,
      mrUrl: contractFields.mrUrl || null,
      mrUrlSource: contractFields.mrUrlSource,
      dataQuality: contractFields.dataQuality,
    },
    ...(collaborationMetrics ? { collaborationMetrics } : {}),
  };

  if ((result.ok || result.skipped) && clearSession) {
    output.session = clearOperatorSession();
  }

  console.log(JSON.stringify(output, null, 2));
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
 * @llm-review-submitted-at 2026-07-15T07:20:00.000Z
 * @llm-review-model cursor-grok
 * @llm-review-note OL-6：send-operator-log 自動補 ticket／mrUrl／ticketSource／dataQuality。
 */

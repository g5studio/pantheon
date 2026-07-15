#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module operator-session
 * @purpose 記錄 operator 指令 workflow 起點，並可綁定 ticket 供 send-operator-log 推導。
 * @external https://innotech.atlassian.net/browse/OL-6
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../utilities/env-loader.mjs";
import { captureGitSnapshot } from "./operator-collaboration-metrics.mjs";
import {
  normalizeTicket,
  warnIdentityGaps,
} from "./operator-workflow-contract.mjs";

const SESSION_FILE_NAME = ".operator-session.json";

const VALID_USER_RESPONSE_TYPES = new Set([
  "directAgree",
  "requestChange",
  "question",
  "silentConfirm",
]);

/**
 * 宣告內容用途說明與單號關聯
 * @description 回傳 operator session 檔案路徑。
 * @purpose 集中管理 session 檔位置（.cursor/tmp/.operator-session.json）。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function getOperatorSessionPath() {
  return join(getProjectRoot(), ".cursor", "tmp", SESSION_FILE_NAME);
}

function exec(command, options = {}) {
  return execSync(command, {
    cwd: getProjectRoot(),
    encoding: "utf-8",
    stdio: options.silent ? "pipe" : "inherit",
    ...options,
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function normalizeIsoTime(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 start-task git notes 中的 startedAt。
 * @purpose 作為 @git-notes started-at 來源的 fallback。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function readStartTaskNotesStartedAt() {
  const candidates = ["HEAD", "HEAD^"];

  try {
    candidates.push(exec("git merge-base HEAD main", { silent: true }).trim());
  } catch {
    // ignore
  }

  for (const ref of candidates) {
    try {
      const noteContent = exec(`git notes --ref=start-task show ${ref}`, {
        silent: true,
      }).trim();
      if (!noteContent) continue;
      const info = safeJsonParse(noteContent);
      if (!info || typeof info !== "object") continue;
      const startedAt = normalizeIsoTime(info.workflowStartedAt || info.startedAt);
      if (startedAt) return startedAt;
    } catch {
      // try next ref
    }
  }

  return null;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 session 原始 JSON（不做時間正規化）。
 * @purpose 供 event/checkpoint 內部更新。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function readOperatorSessionRaw() {
  const sessionPath = getOperatorSessionPath();
  if (!existsSync(sessionPath)) return null;

  const parsed = safeJsonParse(readFileSync(sessionPath, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 寫入完整 session 物件。
 * @purpose 供 event/checkpoint 更新 session。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function writeOperatorSessionObject(session) {
  const sessionPath = getOperatorSessionPath();
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf-8");
  return session;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 追加協作事件至 session.events。
 * @purpose Agent 在決策點記錄 user-response / plan-revision 等。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function appendOperatorSessionEvent(event = {}) {
  const session = readOperatorSessionRaw();
  if (!session?.workflowStartedAt) {
    throw new Error("找不到有效 operator session，請先執行 --action=start");
  }

  const normalizedEvent = {
    occurredAt: new Date().toISOString(),
    ...event,
  };

  const events = Array.isArray(session.events) ? session.events : [];
  events.push(normalizedEvent);

  const nextSession = {
    ...session,
    events,
    lastEventAt: normalizedEvent.occurredAt,
  };

  if (normalizedEvent.type === "plan-initial") {
    nextSession.planMetrics = {
      ...(session.planMetrics || {}),
      initialPlanAt: normalizedEvent.occurredAt,
    };
  }

  if (normalizedEvent.type === "plan-confirmed") {
    nextSession.planMetrics = {
      ...(nextSession.planMetrics || session.planMetrics || {}),
      confirmedAt: normalizedEvent.occurredAt,
    };
  }

  return writeOperatorSessionObject(nextSession);
}

function recordSessionEventFromCli(args) {
  const eventType = String(args["event-type"] || args.eventType || "").trim();
  if (!eventType) {
    throw new Error("event 需要 --event-type=<type>");
  }

  if (eventType === "user-response") {
    const responseType = String(args["response-type"] || args.responseType || "").trim();
    if (!VALID_USER_RESPONSE_TYPES.has(responseType)) {
      throw new Error(
        `無效的 --response-type: ${responseType}（支援 directAgree/requestChange/question/silentConfirm）`,
      );
    }
    return appendOperatorSessionEvent({ type: "user-response", responseType });
  }

  if (eventType === "plan-initial") {
    return appendOperatorSessionEvent({ type: "plan-initial" });
  }

  if (eventType === "plan-revision") {
    return appendOperatorSessionEvent({ type: "plan-revision" });
  }

  if (eventType === "plan-confirmed") {
    return appendOperatorSessionEvent({ type: "plan-confirmed" });
  }

  if (eventType === "fix-comment-reply") {
    const text = String(args.text || "").trim();
    if (!text) {
      throw new Error("fix-comment-reply 需要 --text=<reply>");
    }
    return appendOperatorSessionEvent({ type: "fix-comment-reply", text });
  }

  if (eventType === "session-resume") {
    writeOperatorSessionCheckpoint("session-resume");
    return appendOperatorSessionEvent({ type: "session-resume" });
  }

  if (eventType === "ai-completed") {
    const value = String(args.value ?? "true").trim().toLowerCase();
    const aiCompleted = !["false", "0", "no"].includes(value);
    const session = readOperatorSessionRaw();
    if (!session?.workflowStartedAt) {
      throw new Error("找不到有效 operator session，請先執行 --action=start");
    }
    return writeOperatorSessionObject({ ...session, aiCompleted });
  }

  throw new Error(`未知 --event-type: ${eventType}`);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取目前 operator session。
 * @purpose 供 send-operator-log 以 @session 推算 duration。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function readOperatorSession() {
  const parsed = readOperatorSessionRaw();
  if (!parsed) return null;

  const workflowStartedAt = normalizeIsoTime(parsed.workflowStartedAt);
  if (!workflowStartedAt) return null;

  return {
    ...parsed,
    workflowStartedAt,
    projectRoot: parsed.projectRoot || getProjectRoot(),
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 更新既有 session 的 ticket（不重設 workflow 起點）。
 * @purpose OL-6：流程中途補綁單號。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function setOperatorSessionTicket(ticket) {
  const session = readOperatorSessionRaw();
  if (!session?.workflowStartedAt) {
    throw new Error("找不到有效 operator session，請先執行 --action=start");
  }

  const normalized = normalizeTicket(ticket);
  if (!normalized) {
    throw new Error("set 需要有效 --ticket=<JIRA-KEY>（例如 OL-6）");
  }

  return writeOperatorSessionObject({
    ...session,
    ticket: normalized,
    ticketBoundAt: new Date().toISOString(),
  });
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 寫入 operator session（指令 workflow 起點）。
 * @purpose Agent 在 operator 指令入口呼叫，記錄 workflowStartedAt；可選綁 ticket。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function writeOperatorSession({ action, ticket = "", extra = {} } = {}) {
  const normalizedAction = String(action || "").trim();
  if (!normalizedAction) {
    throw new Error("writeOperatorSession 需要 action");
  }

  const gitSnapshotStart = captureGitSnapshot();
  const normalizedTicket = normalizeTicket(ticket);

  const session = {
    action: normalizedAction,
    workflowStartedAt: new Date().toISOString(),
    projectRoot: getProjectRoot(),
    gitSnapshotStart,
    events: [],
    planMetrics: {},
    checkpoints: [],
    ...(normalizedTicket ? { ticket: normalizedTicket } : {}),
    ...(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}),
  };

  return writeOperatorSessionObject(session);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 記錄 session checkpoint（對話恢復時比對人工改碼）。
 * @purpose 支援 abandonedAiCollaboration 推斷。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function writeOperatorSessionCheckpoint(label = "") {
  const session = readOperatorSessionRaw();
  if (!session?.workflowStartedAt) {
    throw new Error("找不到有效 operator session，請先執行 --action=start");
  }

  const checkpoint = {
    label: String(label || "").trim() || "checkpoint",
    capturedAt: new Date().toISOString(),
    gitSnapshot: captureGitSnapshot(),
  };

  const checkpoints = Array.isArray(session.checkpoints) ? session.checkpoints : [];
  checkpoints.push(checkpoint);

  return writeOperatorSessionObject({
    ...session,
    checkpoints,
    gitSnapshotLatest: checkpoint.gitSnapshot,
  });
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 session 並附加終點 git 快照。
 * @purpose 供 send-operator-log 彙整 collaborationMetrics。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function readOperatorSessionForMetrics() {
  const session = readOperatorSessionRaw();
  if (!session?.workflowStartedAt) return null;

  return {
    ...session,
    gitSnapshotEnd: captureGitSnapshot(),
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 清除 operator session 檔案。
 * @purpose workflow log 成功送出後清理 session。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function clearOperatorSession() {
  const sessionPath = getOperatorSessionPath();
  if (!existsSync(sessionPath)) {
    return { cleared: false, reason: "session-not-found" };
  }
  unlinkSync(sessionPath);
  return { cleared: true };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 started-at 來源（@session、@git-notes 或 ISO 字串）。
 * @purpose send-operator-log 自動推算 durationMs。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function resolveWorkflowStartedAt(source, { action = "" } = {}) {
  const raw = String(source || "").trim();

  if (!raw || raw === "@session") {
    const session = readOperatorSession();
    if (session?.workflowStartedAt) {
      return {
        startedAt: session.workflowStartedAt,
        source: "session",
        sessionAction: session.action || null,
      };
    }
    if (action === "start-task") {
      const notesStartedAt = readStartTaskNotesStartedAt();
      if (notesStartedAt) {
        return { startedAt: notesStartedAt, source: "git-notes" };
      }
    }
    return { startedAt: null, source: "session", sessionAction: null };
  }

  if (raw === "@git-notes") {
    const notesStartedAt = readStartTaskNotesStartedAt();
    return {
      startedAt: notesStartedAt,
      source: "git-notes",
    };
  }

  const iso = normalizeIsoTime(raw);
  if (!iso) {
    throw new Error(
      `無效的 --started-at 值: ${raw}（支援 ISO 8601、@session、@git-notes）`,
    );
  }
  return { startedAt: iso, source: "explicit" };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依起點時間計算流程 durationMs。
 * @purpose 對齊 Ares dashboard 整段 operator 指令耗時。
 * @external https://innotech.atlassian.net/browse/FE-8460
 */
export function computeWorkflowDurationMs(startedAtIso, endedAtMs = Date.now()) {
  const normalizedStartedAt = normalizeIsoTime(startedAtIso);
  if (!normalizedStartedAt) return null;

  const startedMs = new Date(normalizedStartedAt).getTime();
  const duration = Math.round(endedAtMs - startedMs);
  return duration >= 0 ? duration : 0;
}

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
    result[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  }
  return result;
}

function printUsage() {
  console.error(`
Operator Session CLI

Usage:
  node .cursor/scripts/operator/operator-session.mjs --action=<action> [options]

Actions:
  start        記錄 operator workflow 起點（寫入 .cursor/tmp/.operator-session.json）
  set          更新 session 綁定 ticket（不重設起點時間）
  read         讀取目前 session（JSON 輸出）
  clear        清除 session 檔案
  event        追加協作事件（user-response / plan-revision / fix-comment-reply 等）
  checkpoint   記錄 git checkpoint（對話恢復時比對人工改碼）

Options (start):
  --command=<name>   operator 指令名稱（必填），例如 start-task、fix-comment
  --ticket=<KEY>     可選；綁定 Jira ticket（例如 OL-6）

Options (set):
  --ticket=<KEY>     必填；更新 session.ticket

Options (event):
  --event-type=<type>                 事件類型（必填）
  --response-type=<name>              user-response 專用：directAgree | requestChange | question | silentConfirm
  --text=<reply>                      fix-comment-reply 專用
  --value=true|false                  ai-completed 專用

Options (checkpoint):
  --label=<text>                      checkpoint 標籤（選填）

Examples:
  node .cursor/scripts/operator/operator-session.mjs --action=start --command=start-task --ticket=OL-6
  node .cursor/scripts/operator/operator-session.mjs --action=set --ticket=OL-6
  node .cursor/scripts/operator/operator-session.mjs --action=event --event-type=user-response --response-type=directAgree
  node .cursor/scripts/operator/operator-session.mjs --action=event --event-type=plan-revision
  node .cursor/scripts/operator/operator-session.mjs --action=event --event-type=fix-comment-reply --text="已調整命名"
  node .cursor/scripts/operator/operator-session.mjs --action=checkpoint --label=after-human-edit
  node .cursor/scripts/operator/operator-session.mjs --action=read
  node .cursor/scripts/operator/operator-session.mjs --action=clear
`.trim());
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = String(args.action || "").trim().toLowerCase();

  if (!action) {
    printUsage();
    process.exit(1);
  }

  if (action === "start") {
    const command = String(args.command || "").trim();
    if (!command) {
      throw new Error("start 需要 --command=<operator-command>");
    }
    warnIdentityGaps({ context: "operator-session:start" });
    const ticket = String(args.ticket || "").trim();
    const session = writeOperatorSession({ action: command, ticket });
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }

  if (action === "set") {
    const ticket = String(args.ticket || "").trim();
    const session = setOperatorSessionTicket(ticket);
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }

  if (action === "read") {
    const session = readOperatorSession();
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }

  if (action === "clear") {
    const result = clearOperatorSession();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (action === "event") {
    const session = recordSessionEventFromCli(args);
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }

  if (action === "checkpoint") {
    const label = String(args.label || "").trim();
    const session = writeOperatorSessionCheckpoint(label);
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }

  throw new Error(`未知 action: ${action}`);
}

const isDirectRun =
  process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
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
  }
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-15T07:20:00.000Z
 * @llm-review-model cursor-grok
 * @llm-review-note OL-6：session start／set 支援 ticket 綁定與身分預檢警告。
 */

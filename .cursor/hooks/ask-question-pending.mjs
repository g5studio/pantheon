/**
 * 檔案用途區塊
 * @module ask-question-pending
 * @purpose AskQuestion 等待決策通知的排程、取消與狀態管理（30 秒冷卻）
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "fs";
import { basename, join } from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { buildAskQuestionNotificationMessage } from "./notify-on-ask-question-message.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 用戶未操作時，等待多久才發送決策通知（毫秒） */
export const ASK_QUESTION_NOTIFY_COOLDOWN_MS = Number(
  process.env.ASK_QUESTION_NOTIFY_COOLDOWN_MS || 30_000,
);

const STATE_DIR_NAME = ".cursor/tmp";
const STATE_FILE_NAME = "ask-question-pending.json";

/**
 * 宣告內容用途說明與單號關聯
 * @description 取得 pending 狀態檔路徑（位於 .cursor/tmp，已 gitignore）。
 * @purpose 以 cwd 區分不同 workspace 的排程狀態。
 */
export function getPendingStatePath(cwd) {
  return join(cwd, STATE_DIR_NAME, STATE_FILE_NAME);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取目前 workspace 的 pending 通知狀態。
 * @purpose 供 scheduler 與 cancel hook 判斷是否仍應發送。
 */
export function readPendingState(cwd) {
  const statePath = getPendingStatePath(cwd);
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 寫入 pending 通知狀態。
 * @purpose 記錄排程 id、pid、通知內容與到期時間。
 */
export function writePendingState(cwd, state) {
  const statePath = getPendingStatePath(cwd);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 清除 pending 狀態檔。
 * @purpose 通知已發送或已取消後清理。
 */
export function clearPendingState(cwd) {
  const statePath = getPendingStatePath(cwd);
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 嘗試終止既有的 scheduler 子行程。
 * @purpose 新 AskQuestion 或使用者已操作時避免重複通知。
 */
export function killSchedulerProcess(pid) {
  if (!pid || typeof pid !== "number") return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // 行程可能已結束
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依 Pantheon 路徑規則解析 notify 腳本位置。
 * @purpose scheduler 到期後發送 OS / Hermes 通知。
 */
export function resolveNotifyScriptPath(cwd) {
  const candidates = [
    join(
      cwd,
      ".pantheon",
      ".cursor",
      "scripts",
      "notification",
      "notify-cursor-rules-failed.mjs",
    ),
    join(cwd, ".cursor", "scripts", "notification", "notify-cursor-rules-failed.mjs"),
    join(__dirname, "..", "scripts", "notification", "notify-cursor-rules-failed.mjs"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 實際呼叫 notify 腳本發送通知。
 * @purpose 冷卻時間到且未被取消時執行。
 */
export function sendNotificationNow({ projectName, message, cwd }) {
  const notifyScript = resolveNotifyScriptPath(cwd);
  if (!notifyScript) {
    console.error("[ask-question-pending] notify script not found");
    return false;
  }

  const result = spawnSync(
    process.execPath,
    [notifyScript, projectName, message],
    { cwd, stdio: "inherit", env: process.env },
  );

  if (result.error) {
    console.error(
      `[ask-question-pending] notify failed: ${result.error.message}`,
    );
    return false;
  }

  return true;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 取消目前 workspace 的 pending 決策通知（若存在）。
 * @purpose 使用者已選 Answer、送出 prompt 或 Agent 繼續執行其他 tool 時呼叫。
 */
export function cancelPendingNotification(cwd, reason = "user-action") {
  const state = readPendingState(cwd);
  if (!state || state.status !== "pending") return false;

  killSchedulerProcess(state.schedulerPid);
  writePendingState(cwd, {
    ...state,
    status: "cancelled",
    cancelledAt: Date.now(),
    cancelReason: reason,
  });

  return true;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description AskQuestion 後排程延遲通知（預設 30 秒冷卻）。
 * @purpose 使用者仍在 chat 內操作時不打扰；離開後才提醒 pending 問題。
 */
export function scheduleAskQuestionNotification({
  cwd,
  toolInput,
  cooldownMs = ASK_QUESTION_NOTIFY_COOLDOWN_MS,
}) {
  cancelPendingNotification(cwd, "replaced-by-new-question");

  const pendingId = randomUUID();
  const projectName = basename(cwd);
  const message = buildAskQuestionNotificationMessage(toolInput);
  const now = Date.now();

  const hookScript = join(__dirname, "notify-on-ask-question.mjs");
  const child = spawn(
    process.execPath,
    [hookScript, "--run-scheduler", `--pending-id=${pendingId}`, `--cwd=${cwd}`],
    {
      cwd,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ASK_QUESTION_NOTIFY_COOLDOWN_MS: String(cooldownMs),
      },
    },
  );
  child.unref();

  writePendingState(cwd, {
    id: pendingId,
    status: "pending",
    scheduledAt: now,
    notifyAt: now + cooldownMs,
    cooldownMs,
    schedulerPid: child.pid,
    projectName,
    message,
    cwd,
  });

  return pendingId;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description Scheduler 子行程：sleep 冷卻時間後，若仍 pending 則發通知。
 * @purpose 由 scheduleAskQuestionNotification 以 detached 方式啟動。
 */
export async function runNotificationScheduler({ pendingId, cwd }) {
  const state = readPendingState(cwd);
  if (!state || state.id !== pendingId) {
    process.exit(0);
  }

  const cooldownMs = state.cooldownMs || ASK_QUESTION_NOTIFY_COOLDOWN_MS;
  await new Promise((resolve) => setTimeout(resolve, cooldownMs));

  const latest = readPendingState(cwd);
  if (!latest || latest.id !== pendingId || latest.status !== "pending") {
    process.exit(0);
  }

  sendNotificationNow({
    projectName: latest.projectName,
    message: latest.message,
    cwd: latest.cwd,
  });

  writePendingState(cwd, {
    ...latest,
    status: "sent",
    sentAt: Date.now(),
  });

  process.exit(0);
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-23T00:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note 新增 30 秒冷卻排程與取消邏輯，避免使用者仍在 chat 時重複通知。
 */

#!/usr/bin/env node

/**
 * Label 分析器
 * 用於從 Jira 獲取信息並決定 MR 的 labels
 *
 * 注意：v3/v4 UI 版本的 labels 應由 AI 在 chat 中根據改動內容判斷後傳入
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute, join } from "path";
import {
  getProjectRoot,
  getJiraConfig,
  guideJiraConfig,
} from "../utilities/env-loader.mjs";

// 使用 env-loader 提供的 projectRoot
const projectRoot = getProjectRoot();

const DEFAULT_START_TASK_INFO_FILE = join(
  projectRoot,
  ".cursor",
  "tmp",
  "start-task-info.json"
);
const DEFAULT_DEVELOPMENT_PLAN_FILE = join(
  projectRoot,
  ".cursor",
  "tmp",
  "development-plan.md"
);
const DEFAULT_DEVELOPMENT_REPORT_FILE = join(
  projectRoot,
  ".cursor",
  "tmp",
  "development-report.md"
);

function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.silent) {
      console.error(`錯誤: ${error.message}`);
    }
    throw error;
  }
}

function resolvePathFromProjectRoot(filePath) {
  if (!filePath) return null;
  return isAbsolute(filePath) ? filePath : join(projectRoot, filePath);
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasNonEmptyFile(filePath) {
  const resolved = resolvePathFromProjectRoot(filePath);
  if (!resolved) return false;
  try {
    if (!existsSync(resolved)) return false;
    const st = statSync(resolved);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function isSameTicket(a, b) {
  const ta = typeof a === "string" ? a.trim().toUpperCase() : "";
  const tb = typeof b === "string" ? b.trim().toUpperCase() : "";
  return !!ta && !!tb && ta === tb;
}

function hasAIDevelopmentPlan(taskInfo, options = {}) {
  if (!taskInfo) return false;
  if (taskInfo.aiDevelopmentPlan === false) return false;
  const filePath =
    options.developmentPlanFile ||
    taskInfo.developmentPlanFile ||
    DEFAULT_DEVELOPMENT_PLAN_FILE;
  return hasNonEmptyFile(filePath);
}

function hasAIDevelopmentReport(taskInfo, options = {}) {
  if (!taskInfo) return false;
  if (taskInfo.aiDevelopmentReport === false) return false;
  const filePath =
    options.developmentReportFile ||
    taskInfo.developmentReportFile ||
    DEFAULT_DEVELOPMENT_REPORT_FILE;
  return hasNonEmptyFile(filePath);
}

// 獲取 Jira ticket 的 fix version
export async function getJiraFixVersion(ticket) {
  if (!ticket || ticket === "N/A") {
    return null;
  }

  let config;
  try {
    config = getJiraConfig();
  } catch (error) {
    console.log(
      `⚠️  無法獲取 ticket ${ticket} 的 fix version：${error.message}\n`
    );
    return null;
  }

  if (!config || !config.email || !config.apiToken) {
    console.log(
      `⚠️  未設置 Jira API 認證信息，無法獲取 ticket ${ticket} 的 fix version\n`
    );
    guideJiraConfig();
    return null;
  }

  try {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    );
    const baseUrl = config.baseUrl.endsWith("/")
      ? config.baseUrl.slice(0, -1)
      : config.baseUrl;
    const url = `${baseUrl}/rest/api/3/issue/${ticket}`;
    console.log(`🔍 正在從 Jira 獲取 ticket ${ticket} 的 fix version...`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`⚠️  找不到 Jira ticket: ${ticket}\n`);
      } else if (response.status === 401 || response.status === 403) {
        console.log(
          `\n❌ Jira API Token 已過期或無權限 (${response.status})\n`
        );
        console.log(`   請聯繫最高管理員: william.chiang\n`);
        throw new Error("Jira API Token 已過期，請聯繫 william.chiang");
      } else {
        console.log(
          `⚠️  獲取 Jira ticket ${ticket} 信息失敗: ${response.status} ${response.statusText}\n`
        );
      }
      return null;
    }

    const data = await response.json();
    const fixVersions = data.fields?.fixVersions || [];

    if (fixVersions.length === 0) {
      console.log(`ℹ️  Jira ticket ${ticket} 沒有設置 fix version\n`);
      return null;
    }

    const fixVersion = fixVersions[0].name;
    console.log(
      `✅ 成功獲取 Jira ticket ${ticket} 的 fix version: ${fixVersion}\n`
    );
    return fixVersion;
  } catch (error) {
    if (error.message && error.message.includes("Jira API Token")) {
      throw error;
    }
    console.log(
      `⚠️  獲取 Jira ticket ${ticket} 的 fix version 失敗: ${error.message}\n`
    );
    return null;
  }
}

// 從 fix version 提取版本 label（例如：5.35.0 -> v5.35, 5.35.3 -> v5.35）
export function extractVersionLabel(fixVersion) {
  if (!fixVersion) {
    return null;
  }

  const match = fixVersion.match(/^(\d+)\.(\d+)(?:\.\d+)?/);
  if (match) {
    const major = match[1];
    const minor = match[2];
    return `v${major}.${minor}`;
  }

  return null;
}

// 從 fix version 提取 release branch 名稱（例如：5.35.1 -> release/5.35）
export function extractReleaseBranch(fixVersion) {
  if (!fixVersion) {
    return null;
  }

  const match = fixVersion.match(/^(\d+)\.(\d+)(?:\.\d+)?/);
  if (match) {
    const major = match[1];
    const minor = match[2];
    return `release/${major}.${minor}`;
  }

  return null;
}

// 檢查 fix version 是否為 hotfix（最後數字非 0）
export function isHotfixVersion(fixVersion) {
  if (!fixVersion) {
    return false;
  }

  const match = fixVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (match) {
    const patch = parseInt(match[3], 10);
    return patch !== 0;
  }

  return false;
}

// 讀取 start-task 資訊（預設從 .cursor/tmp/start-task-info.json；可用參數覆蓋）
export function readStartTaskInfo(options = {}) {
  try {
    const filePath =
      options.startTaskInfoFile || DEFAULT_START_TASK_INFO_FILE;
    const resolved = resolvePathFromProjectRoot(filePath);
    if (!resolved || !existsSync(resolved)) return null;
    const raw = readFileSync(resolved, "utf-8").replace(/^\uFEFF/, "").trim();
    return safeJsonParse(raw);
  } catch (error) {
    return null;
  }
}

/**
 * 根據 ticket 和選項決定 labels
 *
 * 注意：此函數不再自動分析 v3/v4 影響範圍
 * v3/v4 UI labels (3.0UI, 4.0UI) 應由 AI 在 chat 中判斷後透過 --labels 參數傳入
 *
 * @param {string} ticket - Jira ticket 編號
 * @param {object} options - 選項
 * @param {object} options.startTaskInfo - start-task 開發計劃信息
 * @param {string} options.startTaskInfoFile - start-task-info.json 路徑（可相對於專案根目錄）
 * @param {string} options.developmentPlanFile - development-plan.md 路徑（可相對於專案根目錄）
 * @param {string} options.developmentReportFile - development-report.md 路徑（可相對於專案根目錄）
 * @returns {Promise<{labels: string[], releaseBranch: string|null}>}
 */
export async function determineLabels(ticket, options = {}) {
  const {
    startTaskInfo = null,
    startTaskInfoFile = null,
    developmentPlanFile = null,
    developmentReportFile = null,
  } = options;
  const labels = [];
  let releaseBranch = null;

  // 檢查是否需要加 AI label：
  // - 必須同 ticket
  // - 必須存在 start-task 產生的 AI 開發計畫或開發報告檔案（以檔案存在為主）
  const taskInfo =
    startTaskInfo || readStartTaskInfo({ startTaskInfoFile });
  const sameTicket = isSameTicket(taskInfo?.ticket, ticket);
  const hasPlan = hasAIDevelopmentPlan(taskInfo, { developmentPlanFile });
  const hasReport = hasAIDevelopmentReport(taskInfo, { developmentReportFile });

  if (sameTicket && (hasPlan || hasReport)) {
    labels.push("AI");
    console.log("🤖 檢測到同 ticket 且存在 AI plan/report，將添加 AI label\n");
  } else if (taskInfo && !sameTicket) {
    console.log(
      `ℹ️  偵測到 start-task-info 但 ticket 不一致（taskInfo: ${taskInfo?.ticket} / current: ${ticket}），不添加 AI label\n`
    );
  } else if (taskInfo && sameTicket && !hasPlan && !hasReport) {
    console.log(
      "ℹ️  偵測到 start-task-info 但未找到 AI plan/report 檔案，不添加 AI label\n"
    );
  }

  // 如果 Jira ticket 開頭是 FE，添加 FE Board label
  if (ticket && ticket.startsWith("FE-")) {
    labels.push("FE Board");
  }

  // 獲取 Jira ticket 的 fix version 並添加版本 label
  if (ticket && ticket !== "N/A") {
    try {
      const fixVersion = await getJiraFixVersion(ticket);
      if (fixVersion) {
        console.log(`📋 Jira ticket ${ticket} 的 fix version: ${fixVersion}`);
        const versionLabel = extractVersionLabel(fixVersion);
        if (versionLabel) {
          console.log(`   → 提取版本 label: ${versionLabel}`);
          labels.push(versionLabel);
        }

        // 如果 fix version 最後數字非 0，添加 Hotfix label
        if (isHotfixVersion(fixVersion)) {
          console.log(`   → 檢測到 Hotfix 版本，將添加 Hotfix label`);
          labels.push("Hotfix");
          releaseBranch = extractReleaseBranch(fixVersion);
        }
        console.log("");
      }
    } catch (error) {
      if (error.message && error.message.includes("Jira API Token")) {
        // Token 過期，不添加版本 label
      }
    }
  }

  return { labels, releaseBranch };
}

// 導出 projectRoot 供其他腳本使用
export { projectRoot };

#!/usr/bin/env node

/**
 * Label 分析器
 * 用於從 Jira 獲取信息並決定 MR 的 labels
 *
 * 注意：v3/v4 UI 版本的 labels 應由 AI 在 chat 中根據改動內容判斷後傳入
 */

import { execSync } from "child_process";
import {
  getProjectRoot,
  getJiraConfig,
  guideJiraConfig,
} from "../utilities/env-loader.mjs";

// 使用 env-loader 提供的 projectRoot
const projectRoot = getProjectRoot();

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

// 讀取 start-task 開發計劃（從 Git notes）
export function readStartTaskInfo() {
  try {
    const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();
    try {
      const noteContent = exec(
        `git notes --ref=start-task show ${currentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // 當前 commit 沒有 Git notes
    }

    try {
      const parentCommit = exec("git rev-parse HEAD^", { silent: true }).trim();
      const noteContent = exec(
        `git notes --ref=start-task show ${parentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // 父 commit 沒有 Git notes
    }

    try {
      const baseCommit = exec("git merge-base HEAD main", {
        silent: true,
      }).trim();
      const noteContent = exec(
        `git notes --ref=start-task show ${baseCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // base commit 沒有 Git notes
    }

    return null;
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
 * @returns {Promise<{labels: string[], releaseBranch: string|null}>}
 */
export async function determineLabels(ticket, options = {}) {
  const { startTaskInfo = null } = options;
  const labels = [];
  let releaseBranch = null;

  // 檢查是否由 start-task 啟動（透過傳入的參數或讀取 Git notes）
  const taskInfo = startTaskInfo || readStartTaskInfo();
  if (taskInfo) {
    labels.push("AI");
    console.log("🤖 檢測到由 start-task 啟動，將添加 AI label\n");
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

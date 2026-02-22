#!/usr/bin/env node

/**
 * Label 分析器
 * 用於從 Jira 獲取信息並決定 MR 的 labels
 *
 * 注意：v3/v4 UI 版本的 labels 應由 AI 在 chat 中根據改動內容判斷後傳入
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  getProjectRoot,
  getJiraConfig,
  guideJiraConfig,
  loadEnvLocal,
} from "../utilities/env-loader.mjs";
import { callOpenAiJson, resolveLlmModel } from "../utilities/llm-client.mjs";

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

function safeJsonParse(text, hint = "JSON") {
  try {
    return JSON.parse(String(text || ""));
  } catch (e) {
    throw new Error(`${hint} 解析失敗：${e.message}`);
  }
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const v = String(raw || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function truncateText(text, maxChars) {
  const s = String(text || "");
  if (!maxChars || s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n... [truncated ${s.length - maxChars} chars]`;
}

function getDefaultAdaptJsonPath() {
  return join(projectRoot, ".cursor", "tmp", "pantheon", "adapt.json");
}

function readAdaptKnowledge() {
  const filePath = getDefaultAdaptJsonPath();
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  return safeJsonParse(text, "adapt.json");
}

function getChangesSinceBase(baseRef) {
  const ref = baseRef || "origin/main";
  const nameStatus = exec(`git diff --name-status ${ref}...HEAD`, {
    silent: true,
  });
  const stat = exec(`git diff --stat ${ref}...HEAD`, { silent: true });
  // diff 可能很大：只截斷後給 LLM
  const diff = exec(`git diff ${ref}...HEAD`, { silent: true });
  const commits = exec(`git log --oneline ${ref}..HEAD`, { silent: true });

  return {
    baseRef: ref,
    nameStatus: nameStatus || "",
    stat: stat || "",
    commits: commits || "",
    diff: diff || "",
  };
}

async function getJiraTicketInfo(ticket) {
  if (!ticket || ticket === "N/A") return null;

  let config;
  try {
    config = getJiraConfig();
  } catch (error) {
    console.log(`⚠️  無法讀取 Jira 設定：${error.message}\n`);
    return null;
  }

  if (!config || !config.email || !config.apiToken) {
    console.log(`⚠️  未設置 Jira API 認證信息，無法讀取 ${ticket}\n`);
    guideJiraConfig();
    return null;
  }

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64",
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const url = `${baseUrl}/rest/api/3/issue/${ticket}`;

  console.log(`🔍 正在從 Jira 獲取 ticket ${ticket} 的資訊...`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.log(`⚠️  找不到 Jira ticket: ${ticket}\n`);
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      console.log(`\n❌ Jira API Token 已過期或無權限 (${response.status})\n`);
      console.log(`   請聯繫最高管理員: william.chiang\n`);
      throw new Error("Jira API Token 已過期，請聯繫 william.chiang");
    }
    console.log(
      `⚠️  獲取 Jira ticket ${ticket} 信息失敗: ${response.status} ${response.statusText}\n`,
    );
    return null;
  }

  const data = await response.json();
  const fields = data.fields || {};
  const fixVersions = Array.isArray(fields.fixVersions) ? fields.fixVersions : [];
  const fixVersionNames = fixVersions
    .map((v) => v?.name)
    .filter((v) => typeof v === "string" && v.trim().length > 0);

  const summary = typeof fields.summary === "string" ? fields.summary : null;
  const issueType = fields.issuetype?.name || null;

  return {
    key: data.key || ticket,
    summary,
    issueType,
    fixVersions: fixVersionNames,
    fixVersion: fixVersionNames[0] || null,
  };
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

async function suggestLabelsWithLlm({
  ticket,
  jira,
  changes,
  adapt,
  existingLabels = [],
}) {
  const envLocal = loadEnvLocal();
  const apiKey = process.env.OPENAI_API_KEY || envLocal.OPENAI_API_KEY || null;

  const explicitModel =
    typeof envLocal.LABEL_LLM_MODEL === "string" ? envLocal.LABEL_LLM_MODEL : null;
  const model = resolveLlmModel({
    explicitModel,
    envLocal,
    envKeys: ["LABEL_LLM_MODEL", "ADAPT_LLM_MODEL", "AI_MODEL", "LLM_MODEL", "OPENAI_MODEL"],
    defaultModel: "gpt-5.2",
  });

  const system = `
你是一個 GitLab Merge Request labels 決策器。
你會收到：
- changes（git diff / stat / commits）
- jira ticket info
- adapt.json（repo knowledge，含 labels 與 applicable.ok、scenario）

請遵守：
- 只回傳 adapt.json.labels 內存在，且 applicable.ok === true（或 applicable === true / applicable 欄位缺失視為可用）的 labels
- 不要創造新 label
- 不要回傳不確定/不適用的 label

輸出必須是 JSON object，格式：
{
  "labels": string[],
  "reason": string
}
  `.trim();

  const input = {
    ticket,
    jira,
    changes: {
      baseRef: changes?.baseRef || null,
      nameStatus: truncateText(changes?.nameStatus, 4000),
      stat: truncateText(changes?.stat, 4000),
      commits: truncateText(changes?.commits, 4000),
      diff: truncateText(changes?.diff, 12000),
    },
    adapt,
    existingLabels,
  };

  console.log(`🤖 正在請 LLM 建議 labels... (model=${model})`);
  const resp = await callOpenAiJson({
    apiKey,
    model,
    system,
    input,
    temperature: 0.1,
  });

  const labels = uniqStrings(resp?.labels);
  const reason = typeof resp?.reason === "string" ? resp.reason.trim() : "";

  if (reason) console.log(`🧠 LLM 理由（摘要）：${truncateText(reason, 400)}\n`);
  return labels;
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
 * @param {string} options.targetBranch - MR target branch（用於計算 changes base）
 * @returns {Promise<{labels: string[], releaseBranch: string|null}>}
 */
export async function determineLabels(ticket, options = {}) {
  const { startTaskInfo = null, targetBranch = "main" } = options;
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

  // 蒐集 Jira ticket info（提供給 LLM / Hotfix 判定）
  let jiraInfo = null;
  if (ticket && ticket !== "N/A") {
    try {
      jiraInfo = await getJiraTicketInfo(ticket);
    } catch (error) {
      if (error.message && error.message.includes("Jira API Token")) {
        // Token 過期，略過 Jira info
      }
    }
  }

  const fixVersion = jiraInfo?.fixVersion || null;
  const inferredReleaseBranch =
    fixVersion && isHotfixVersion(fixVersion) ? extractReleaseBranch(fixVersion) : null;

  // 蒐集 changes（Hotfix 優先以 release/* 作為 base）
  const baseRef = `origin/${inferredReleaseBranch || targetBranch || "main"}`;
  const changes = getChangesSinceBase(baseRef);

  // 讀取 adapt.json（repo knowledge）
  const adapt = readAdaptKnowledge();

  // LLM labels 建議（會被 create-mr / update-mr 再做可用 label 白名單過濾）
  try {
    const llmLabels = await suggestLabelsWithLlm({
      ticket,
      jira: jiraInfo,
      changes,
      adapt,
      existingLabels: labels,
    });
    for (const l of llmLabels) {
      if (!labels.includes(l)) labels.push(l);
    }
  } catch (e) {
    console.log(`⚠️  LLM labels 建議失敗，將略過：${e.message}\n`);
  }

  // 仍保留 Hotfix target branch 推斷（避免 label 遺漏導致 target branch 不正確）
  if (fixVersion && isHotfixVersion(fixVersion)) {
    if (!labels.includes("Hotfix")) labels.push("Hotfix");
    releaseBranch = inferredReleaseBranch || extractReleaseBranch(fixVersion);
  }

  return { labels, releaseBranch };
}

// 導出 projectRoot 供其他腳本使用
export { projectRoot };

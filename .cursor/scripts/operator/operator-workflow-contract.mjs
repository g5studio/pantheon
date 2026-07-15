#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module operator-workflow-contract
 * @purpose OL-6：腳本保證 workflow log 的 ticket／mrUrl／ticketSource／dataQuality，降低對 Agent 手動 --data 的依賴。
 * @external https://innotech.atlassian.net/browse/OL-6
 */

import { execSync, spawnSync } from "child_process";
import {
  getAgentDisplayName,
  getJiraEmail,
  getProjectRoot,
} from "../utilities/env-loader.mjs";

const TICKET_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * 宣告內容用途說明與單號關聯
 * @description 正規化 Jira-like ticket 字串。
 * @purpose ticket 推導與 session 綁定共用。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function normalizeTicket(raw) {
  const ticket = String(raw || "")
    .trim()
    .toUpperCase();
  if (!ticket) return "";
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(ticket)) return "";
  return ticket;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從文字擷取第一個 ticket。
 * @purpose branch／notes 推導。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function extractFirstTicket(text) {
  const matches = String(text || "").match(TICKET_REGEX);
  return matches?.[0] || "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取目前 git branch 名稱。
 * @purpose ticketSource=branch。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function readGitBranch(projectRoot = getProjectRoot()) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function execSilent(command, projectRoot = getProjectRoot()) {
  return execSync(command, {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從 start-task git notes 讀取 ticket。
 * @purpose ticketSource=git-notes fallback。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function readStartTaskNotesTicket(projectRoot = getProjectRoot()) {
  const candidates = ["HEAD", "HEAD^"];
  try {
    candidates.push(execSilent("git merge-base HEAD main", projectRoot));
  } catch {
    // ignore
  }

  for (const ref of candidates) {
    try {
      const noteContent = execSilent(
        `git notes --ref=start-task show ${ref}`,
        projectRoot,
      );
      if (!noteContent) continue;
      const info = safeJsonParse(noteContent);
      const ticket = normalizeTicket(info?.ticket);
      if (ticket) return ticket;
    } catch {
      // try next
    }
  }
  return "";
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 以 glab 嘗試取得目前 branch 的 opened MR URL。
 * @purpose mrUrl 自動補齊；失敗不阻斷。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function tryResolveMrUrlFromBranch(
  branch = "",
  projectRoot = getProjectRoot(),
) {
  const sourceBranch = String(branch || "").trim();
  if (!sourceBranch || sourceBranch === "HEAD") return null;

  try {
    const listed = spawnSync(
      "glab",
      [
        "mr",
        "list",
        `--source-branch=${sourceBranch}`,
        "--state",
        "opened",
        "--output",
        "json",
      ],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (listed.status === 0) {
      const parsed = safeJsonParse(listed.stdout);
      const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      const url = list[0]?.web_url || list[0]?.webUrl || list[0]?.url;
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  } catch {
    // ignore
  }

  try {
    const viewed = spawnSync("glab", ["mr", "view", "--output", "json"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (viewed.status === 0) {
      const parsed = safeJsonParse(viewed.stdout);
      const url = parsed?.web_url || parsed?.webUrl || parsed?.url;
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 檢查 userEmail／AGENT_DISPLAY_NAME 是否缺失。
 * @purpose dataQuality 與可觀測警告。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function collectIdentityDataQuality() {
  const userEmail = getJiraEmail() || null;
  const agentDisplayName = getAgentDisplayName() || null;
  const missingUserEmail = !userEmail;
  const missingAgentDisplayName = !agentDisplayName;
  return {
    userEmail,
    agentDisplayName,
    missingUserEmail,
    missingAgentDisplayName,
    hasIdentityGaps: missingUserEmail || missingAgentDisplayName,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將身分欄位缺失印到 stderr（不阻斷流程）。
 * @purpose session start／send-operator-log 預檢。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function warnIdentityGaps({ context = "operator" } = {}) {
  const identity = collectIdentityDataQuality();
  if (identity.missingUserEmail) {
    console.warn(
      `⚠️  [${context}] 缺少 JIRA_EMAIL（userEmail）；五維分析可能落入 low confidence`,
    );
  }
  if (identity.missingAgentDisplayName) {
    console.warn(
      `⚠️  [${context}] 缺少 AGENT_DISPLAY_NAME；爆發力／穩定度分組可能不完整`,
    );
  }
  return identity;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 推導 workflow log 的 ticket／mrUrl／ticketSource／dataQuality。
 * @purpose send-operator-log 腳本保證欄位；explicit > session > branch > git-notes > none。
 * @external https://innotech.atlassian.net/browse/OL-6
 */
export function resolveWorkflowContractFields({
  explicitTicket = "",
  explicitMrUrl = "",
  session = null,
  collaborationMetrics = null,
  projectRoot = getProjectRoot(),
  resolveMrUrl = true,
} = {}) {
  const identity = collectIdentityDataQuality();
  const gitBranch = readGitBranch(projectRoot);

  let ticket = normalizeTicket(explicitTicket);
  let ticketSource = "none";
  let ticketConfidence = "low";

  if (ticket) {
    ticketSource = "explicit";
    ticketConfidence = "high";
  } else {
    const sessionTicket = normalizeTicket(session?.ticket);
    if (sessionTicket) {
      ticket = sessionTicket;
      ticketSource = "session";
      ticketConfidence = "high";
    } else {
      const branchTicket = extractFirstTicket(gitBranch);
      if (branchTicket) {
        ticket = branchTicket;
        ticketSource = "branch";
        ticketConfidence = "medium";
      } else {
        const notesTicket = readStartTaskNotesTicket(projectRoot);
        if (notesTicket) {
          ticket = notesTicket;
          ticketSource = "git-notes";
          ticketConfidence = "medium";
        }
      }
    }
  }

  let mrUrl =
    typeof explicitMrUrl === "string" && explicitMrUrl.trim()
      ? explicitMrUrl.trim()
      : "";
  let mrUrlSource = mrUrl ? "explicit" : "none";

  if (!mrUrl && resolveMrUrl) {
    const derived = tryResolveMrUrlFromBranch(gitBranch, projectRoot);
    if (derived) {
      mrUrl = derived;
      mrUrlSource = "branch-mr";
    }
  }

  const planMissing = Boolean(collaborationMetrics?.planMetrics?.missing);
  const dataQuality = {
    missingUserEmail: identity.missingUserEmail,
    missingAgentDisplayName: identity.missingAgentDisplayName,
    ticketMissing: !ticket,
    planMetricsMissing: planMissing,
  };

  return {
    ticket: ticket || null,
    ticketSource,
    ticketConfidence,
    ...(gitBranch ? { gitBranch } : {}),
    ...(mrUrl ? { mrUrl } : {}),
    mrUrlSource,
    dataQuality,
  };
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-15T07:20:00.000Z
 * @llm-review-model cursor-grok
 * @llm-review-note OL-6：新增 workflow ticket／mrUrl／dataQuality 腳本保證推導。
 */

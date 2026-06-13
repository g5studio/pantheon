#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/cr/update-mr.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8177
 * @external https://innotech.atlassian.net/browse/FE-8017
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @external https://innotech.atlassian.net/browse/FE-8007
 * @external https://innotech.atlassian.net/browse/FE-8003
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */

/**
 * 檔案用途區塊
 * @module update-mr.mjs
 * @purpose 依照使用者提供的 development-report 更新既有 Merge Request（含必要段落驗證、description marker-based 合併、labels/reviewer 選擇性更新），並依規則判斷是否送出 AI review。
 * @external https://innotech.atlassian.net/browse/FE-7910
 */

/**
 * 宣告內容用途說明與單號關聯
 * @description 腳本的宣告/常數取得與環境 token 掛鉤：包含專案根目錄、adapt.json 可用 labels 白名單、glab 與 GitLab API 的 email/身分取得、以及 AI review 提交與 notes marker 寫入。
 * @purpose 維持 AI review 僅在偵測到 MR head SHA 有新提交時才送出，並在缺少 COMPASS_API_TOKEN 時跳過送審，其餘流程不受影響。
 * @external https://innotech.atlassian.net/browse/FE-8007
 * @external https://innotech.atlassian.net/browse/FE-7910
 */

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13T17:27:18.737Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 補上三區塊註解（檔案用途區塊/宣告內容用途說明與單號關聯/llm 分析紀錄區），並符合 @module/@purpose/@external、@description/@purpose/@external、@llm-review-* 標籤規格；不影響任何執行邏輯。
 */

/**
 * 更新現有 Merge Request（專用更新腳本）
 *
 * 核心目標：
 * - 任何「修改 MR」都應透過此腳本（create-mr 僅用於建立 MR）
 * - 使用 --development-report 傳入「不跑版」markdown（不產出任何實體檔案）
 * - 更新 description 時以 merge 的概念處理，避免重複內容（marker-based）
 * - 用戶可要求不審核（--no-review）
 * - 未特別說明時預設要審核，但前提是「相對於上次已送審狀態」有 new commit
 * - 沒有 new commit 時不可送審（根源級要求，無繞過參數）
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import readline from "readline";
import {
  getProjectRoot,
  loadEnvLocal,
  getGitLabToken,
  getCompassApiToken,
  getJiraEmail,
  getGitLabToken as getGitLabTokenFromEnvLoader,
} from "../utilities/env-loader.mjs";
import { readStartTaskInfo } from "./label-analyzer.mjs";
import {
  appendAgentSignature,
  stripTrailingAgentSignature,
} from "../utilities/agent-signature.mjs";

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

function readAdaptKnowledgeOrExit() {
  const filePath = join(projectRoot, "adapt.json");
  if (!existsSync(filePath)) {
    console.error("\n❌ 找不到 adapt.json，無法驗證 labels 可用性\n");
    console.error(`📁 預期路徑：${filePath}`);
    console.error(
      "\n✅ 請先執行（擇一）：\n" +
        "   - node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/adapt.mjs\n" +
        "   - node .pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs utilities/adapt.mjs\n",
    );
    process.exit(1);
  }

  try {
    const text = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch (e) {
    console.error("\n❌ 讀取 adapt.json 失敗，無法驗證 labels 可用性\n");
    console.error(`📁 路徑：${filePath}`);
    console.error(`原因：${e.message}\n`);
    process.exit(1);
  }
}

function getAdaptAllowedLabelSet() {
  const knowledge = readAdaptKnowledgeOrExit();
  const list = Array.isArray(knowledge?.labels) ? knowledge.labels : [];
  const allowed = new Set();
  for (const item of list) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!name) continue;

    const a = item.applicable;
    const ok =
      a === undefined ||
      a === null ||
      a === true ||
      (typeof a === "object" && a !== null && a.ok === true);
    if (ok) allowed.add(name);
  }
  return allowed;
}

function filterLabelsByAdaptAllowed(labelsToFilter, allowedSet, labelSource) {
  const input = Array.isArray(labelsToFilter) ? labelsToFilter : [];
  const valid = [];
  const invalid = [];

  for (const raw of input) {
    const label = String(raw || "").trim();
    if (!label) continue;
    if (allowedSet.has(label)) valid.push(label);
    else invalid.push(label);
  }

  if (invalid.length > 0) {
    console.error(
      `\n❌ 以下 ${labelSource} 的 labels 未在 adapt.json 標示為可用，已過濾：\n`,
    );
    invalid.forEach((l) => console.error(`   - ${l}`));
    console.error(
      "\n💡 若要使用上述 labels，請先更新 adapt.json 的 labels/applicable.ok（再重新執行 update-mr）\n",
    );
  }

  return { valid, invalid };
}

function hasGlab() {
  try {
    exec("which glab", { silent: true });
    return true;
  } catch {
    return false;
  }
}

function isGlabAuthenticated(hostname) {
  try {
    const result = exec(`glab auth status --hostname ${hostname}`, {
      silent: true,
    });
    return result.includes("authenticated") || result.includes("✓");
  } catch {
    return false;
  }
}

function loginGlabWithToken(hostname, token) {
  const args = ["auth", "login", "--hostname", hostname, "--token", token];
  const result = spawnSync("glab", args, {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`glab 登入失敗，退出碼: ${result.status}`);
  }
  return true;
}

function getGitLabUserEmailWithGlab() {
  try {
    const result = exec("glab api user", { silent: true });
    if (result && result.trim()) {
      const userInfo = JSON.parse(result);
      return userInfo?.email || null;
    }
  } catch {
    // ignore
  }
  return null;
}

async function getGitLabUserEmailWithApi(hostname = "gitlab.service-hub.tech") {
  try {
    const token = getGitLabTokenFromEnvLoader();
    if (!token) return null;
    const response = await fetch(`https://${hostname}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!response.ok) return null;
    const userInfo = await response.json();
    return userInfo?.email || null;
  } catch {
    return null;
  }
}

async function getAIReviewEmail(hostname = "gitlab.service-hub.tech") {
  if (hasGlab() && isGlabAuthenticated(hostname)) {
    const glabEmail = getGitLabUserEmailWithGlab();
    if (glabEmail) return glabEmail;
  }
  const apiEmail = await getGitLabUserEmailWithApi(hostname);
  if (apiEmail) return apiEmail;
  const jiraEmail = getJiraEmail();
  if (jiraEmail) return jiraEmail;
  return null;
}

function checkAndGuideConfigForAIReview() {
  const missing = [];
  if (!getCompassApiToken()) missing.push("COMPASS_API_TOKEN");

  const hasToken = !!getGitLabTokenFromEnvLoader();
  const hasGlabAuth =
    hasGlab() && isGlabAuthenticated("gitlab.service-hub.tech");
  if (!hasToken && !hasGlabAuth) missing.push("GitLab token 或 glab auth");

  if (missing.length > 0) {
    console.error("\n❌ 缺少 AI review 需要的配置：\n");
    missing.forEach((m) => console.error(`- ${m}`));
    console.error("");
    return false;
  }
  return true;
}

async function submitAIReview(mrUrl) {
  if (!checkAndGuideConfigForAIReview()) {
    throw new Error("配置不完整，無法提交 AI review");
  }

  const apiKey = getCompassApiToken();
  if (!apiKey) throw new Error("無法獲取 COMPASS_API_TOKEN");

  const email = await getAIReviewEmail();
  if (!email)
    throw new Error("無法獲取 email（需 GitLab email 或 JIRA_EMAIL）");

  const apiUrl =
    "https://mac09demac-mini.balinese-python.ts.net/api/workflows/jobs";
  const requestBody = {
    taskId: "code-review",
    version: "v1",
    input: {
      mergeRequestUrl: mrUrl,
      email,
      llm: { provider: "openai", model: "gpt-5-2025-08-07" },
    },
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI review API 請求失敗: ${response.status} ${errorText}`);
  }
  return await response.json();
}

function getCurrentBranch() {
  return exec("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
}

function getGitStatus() {
  try {
    const status = exec("git status --porcelain", { silent: true });
    return status
      .trim()
      .split("\n")
      .filter((line) => line.trim());
  } catch {
    return [];
  }
}

function getLocalHeadSha() {
  return exec("git rev-parse HEAD", { silent: true }).trim();
}

function getOriginHeadSha(branch) {
  return exec(`git rev-parse origin/${branch}`, { silent: true }).trim();
}

function getProjectInfo() {
  const remoteUrl = exec("git config --get remote.origin.url", {
    silent: true,
  }).trim();

  if (remoteUrl.startsWith("git@")) {
    const match = remoteUrl.match(/git@([^:]+):(.+)/);
    if (match) {
      const [, host, path] = match;
      return {
        host: `https://${host}`,
        projectPath: encodeURIComponent(path.replace(/\.git$/, "")),
        fullPath: path.replace(/\.git$/, ""),
      };
    }
  }

  if (remoteUrl.startsWith("https://")) {
    const url = new URL(remoteUrl);
    const pathParts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    const projectPath = pathParts.join("%2F");
    return {
      host: `${url.protocol}//${url.host}`,
      projectPath,
      fullPath: pathParts.join("/"),
    };
  }

  throw new Error("無法解析 remote URL");
}

async function findUserId(token, host, username) {
  try {
    const cleanUsername = String(username || "").replace(/^@/, "");
    if (!cleanUsername) return null;

    const response = await fetch(
      `${host}/api/v4/users?username=${encodeURIComponent(cleanUsername)}`,
      {
        headers: { "PRIVATE-TOKEN": token },
      },
    );
    if (!response.ok) return null;

    const users = await response.json();
    if (Array.isArray(users) && users.length > 0) {
      return users[0]?.id ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function findExistingMRWithGlab(sourceBranch) {
  try {
    const result = exec(
      `glab mr list --source-branch ${sourceBranch} --state opened`,
      { silent: true }
    );
    const match = result.match(/!(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getMRDetailsWithGlab(mrId) {
  try {
    const result = exec(`glab mr view ${mrId} --json`, { silent: true });
    if (result && result.trim()) return JSON.parse(result);
    return null;
  } catch {
    return null;
  }
}

async function findExistingMR(token, host, projectPath, sourceBranch) {
  try {
    const url = `${host}/api/v4/projects/${projectPath}/merge_requests?source_branch=${encodeURIComponent(
      sourceBranch
    )}&state=opened`;
    const response = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!response.ok) return null;
    const mrs = await response.json();
    return mrs.length > 0 ? mrs[0] : null;
  } catch {
    return null;
  }
}

async function getMRDetails(token, host, projectPath, mrIid) {
  try {
    const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;
    const response = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function updateMRDescription(
  token,
  host,
  projectPath,
  mrIid,
  description,
  addLabels = [],
  reviewerId = null
) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;
  const body = { description };
  if (Array.isArray(addLabels) && addLabels.length > 0) {
    // 只帶入 add_labels，避免覆寫現有 labels
    body.add_labels = addLabels.join(",");
  }
  if (reviewerId) {
    body.reviewer_ids = [reviewerId];
  }
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`更新 MR 失敗: ${err}`);
  }
  return await response.json();
}

function normalizeExternalMarkdownArg(input) {
  if (!input) return null;

  let content = input;
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "string") content = parsed;
    else content = JSON.stringify(parsed, null, 2);
  } catch {
    // ignore
  }

  content = content.replace(/\r\n/g, "\n");
  if (!content.includes("\n") && /\\n/.test(content)) {
    content = content.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  }
  if (!content.includes("\t") && /\\t/.test(content)) {
    content = content.replace(/\\t/g, "\t");
  }
  return content;
}

function normalizeIssueTypeName(rawIssueType) {
  if (!rawIssueType) return null;

  const value = String(rawIssueType).trim().toLowerCase();
  if (!value) return null;

  const bugLike = ["bug", "缺陷", "錯誤", "error", "hotfix"];
  if (bugLike.some((keyword) => value.includes(keyword))) {
    return "bug";
  }

  const requestLike = [
    "request",
    "story",
    "task",
    "feature",
    "需求",
    "enhancement",
    "improvement",
  ];
  if (requestLike.some((keyword) => value.includes(keyword))) {
    return "request";
  }

  return null;
}

function extractIssueTypeFromReport(reportMarkdown) {
  if (!reportMarkdown) return null;

  const report = String(reportMarkdown);
  const typeRowMatch = report.match(
    /\|\s*\*{0,2}\s*(?:類型|type)\s*\*{0,2}\s*\|\s*([^|\n]+)\|/i,
  );
  if (typeRowMatch?.[1]) {
    return typeRowMatch[1].trim();
  }

  const hasBugSignals =
    /(^|\n)#{1,6}\s*[^\n]*(影響範圍|根本原因|改動前後邏輯差異)/m.test(report);
  if (hasBugSignals) {
    return "bug";
  }

  const hasRequestSignals =
    /(^|\n)#{1,6}\s*[^\n]*(預期效果|需求覆蓋率|潛在影響風險報告)/m.test(report);
  if (hasRequestSignals) {
    return "request";
  }

  return null;
}

function validateDevelopmentReportSections(reportMarkdown, issueTypeHint) {
  const report = String(reportMarkdown || "");

  const sectionRules = [
    {
      section: "關聯單資訊",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*關聯單資訊/m],
      requiredFor: "all",
    },
    {
      section: "變更摘要",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*變更摘要/m],
      requiredFor: "all",
    },
    {
      section: "風險評估",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*風險評估/m],
      requiredFor: "all",
    },
    {
      section: "影響範圍",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*影響範圍/m],
      requiredFor: "bug",
    },
    {
      section: "根本原因",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*根本原因/m],
      requiredFor: "bug",
    },
    {
      section: "造成問題的單號",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*造成問題的單號/m],
      requiredFor: "bug",
    },
    {
      section: "改動前後邏輯差異",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*改動前後邏輯差異/m],
      requiredFor: "bug",
    },
    {
      section: "預期效果",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*預期效果/m],
      requiredFor: "request",
    },
    {
      section: "需求覆蓋率",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*需求覆蓋率/m],
      requiredFor: "request",
    },
    {
      section: "潛在影響風險報告",
      patterns: [/(^|\n)#{1,6}\s*[^\n]*潛在影響風險報告/m],
      requiredFor: "request",
    },
  ];

  const missingSections = sectionRules
    .filter((rule) => {
      if (rule.requiredFor === "all") return true;
      return issueTypeHint && rule.requiredFor === issueTypeHint;
    })
    .filter(
      (rule) => !rule.patterns.some((pattern) => pattern.test(report)),
    )
    .map((rule) => rule.section);

  return {
    isValid: missingSections.length === 0,
    missingSections,
  };
}

const REPORT_START = "<!-- PANTHEON_DEVELOPMENT_REPORT_START -->";
const REPORT_END = "<!-- PANTHEON_DEVELOPMENT_REPORT_END -->";

const AI_REVIEW_MARKER_PREFIX = "PANTHEON_AI_REVIEW_SHA:";

function buildAiReviewMarkerBody(headSha) {
  // 使用 MR note 記錄狀態（不污染 description）
  return `${AI_REVIEW_MARKER_PREFIX} ${headSha}`;
}

function extractAiReviewShaFromText(text) {
  if (!text) return null;
  const idx = text.indexOf(AI_REVIEW_MARKER_PREFIX);
  if (idx === -1) return null;
  const after = text.slice(idx + AI_REVIEW_MARKER_PREFIX.length).trim();
  const sha = after.split(/\s+/)[0];
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
}

async function listMrNotes(token, host, projectPath, mrIid, perPage = 100) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes?per_page=${perPage}&sort=desc&order_by=updated_at`;
  const response = await fetch(url, { headers: { "PRIVATE-TOKEN": token } });
  if (!response.ok) return [];
  return await response.json();
}

async function upsertAiReviewMarkerNote(
  token,
  host,
  projectPath,
  mrIid,
  headSha
) {
  const notes = await listMrNotes(token, host, projectPath, mrIid, 100);
  const body = appendAgentSignature(buildAiReviewMarkerBody(headSha));
  const existing = notes.find(
    (n) =>
      typeof n.body === "string" && n.body.includes(AI_REVIEW_MARKER_PREFIX)
  );

  if (existing?.id) {
    const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes/${existing.id}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`更新 AI_REVIEW_SHA note 失敗: ${err}`);
    }
    return;
  }

  const createUrl = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`建立 AI_REVIEW_SHA note 失敗: ${err}`);
  }
}

function upsertDevelopmentReport(existingDescription, reportMarkdown) {
  const base =
    typeof existingDescription === "string" ? existingDescription : "";
  const reportBlock = `${REPORT_START}\n${reportMarkdown.trim()}\n${REPORT_END}`;

  // Case 1: marker 已存在 → replace
  const startIdx = base.indexOf(REPORT_START);
  const endIdx = base.indexOf(REPORT_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = base.slice(0, startIdx).trimEnd();
    const after = base.slice(endIdx + REPORT_END.length).trimStart();
    if (!before) return `${reportBlock}\n${after ? `\n\n${after}` : ""}`.trim();
    if (!after) return `${before}\n\n${reportBlock}\n`;
    return `${before}\n\n${reportBlock}\n\n${after}\n`;
  }

  // Case 2: marker 不存在，但已含完整報告格式 → 嘗試用 heuristic 移除舊報告，避免重複
  const lastReportStart = base.lastIndexOf("## 📋 關聯單資訊");
  const agentVersionIdx = base.indexOf("### 🤖 Agent Version");
  const heuristicHasAll =
    lastReportStart !== -1 &&
    base.indexOf("## 📝 變更摘要", lastReportStart) !== -1 &&
    base.indexOf("## ⚠️ 風險評估", lastReportStart) !== -1;
  if (heuristicHasAll) {
    const reportEndIdx = agentVersionIdx !== -1 ? agentVersionIdx : base.length;
    const before = base.slice(0, lastReportStart).trimEnd();
    const after = base.slice(reportEndIdx).trimStart();
    if (!before) return `${reportBlock}\n${after ? `\n\n${after}` : ""}`.trim();
    if (!after) return `${before}\n\n${reportBlock}\n`;
    return `${before}\n\n${reportBlock}\n\n${after}\n`;
  }

  // Case 3: 無法辨識 → 直接 append（仍用 marker，避免後續重複）
  const trimmed = base.trimEnd();
  if (!trimmed) return `${reportBlock}\n`;
  return `${trimmed}\n\n${reportBlock}\n`;
}

async function main() {
  const hostname = "gitlab.service-hub.tech";
  const args = process.argv.slice(2);

  if (args.includes("--review") || args.includes("--force-review")) {
    console.error("\n❌ update-mr 已移除 --review / --force-review\n");
    console.error("💡 預設會在偵測到 new commit 時自動送出 AI review。");
    console.error("   如要跳過審核，請使用 --no-review。\n");
    process.exit(1);
  }

  const reportArg = args.find((a) => a.startsWith("--development-report="));
  const externalReport = reportArg
    ? normalizeExternalMarkdownArg(reportArg.split("=").slice(1).join("="))
    : null;

  if (!externalReport || !externalReport.trim()) {
    console.error("\n❌ update-mr 需要提供 --development-report\n");
    console.error("💡 必須確保傳入的 markdown 不跑版（避免字面 \\\\n）\n");
    process.exit(1);
  }

  const startTaskInfo = readStartTaskInfo();
  const reportIssueType = extractIssueTypeFromReport(externalReport);
  const resolvedIssueType =
    normalizeIssueTypeName(reportIssueType) ||
    normalizeIssueTypeName(startTaskInfo?.issueType);

  const reportValidation = validateDevelopmentReportSections(
    externalReport,
    resolvedIssueType,
  );
  if (!reportValidation.isValid) {
    const typeLabel = resolvedIssueType
      ? resolvedIssueType.toUpperCase()
      : "UNKNOWN";
    console.error("\n❌ development-report 缺少必要區塊，已停止更新 MR\n");
    console.error(`📋 偵測到的報告類型: ${typeLabel}`);
    console.error(
      `🧩 缺少區塊: ${reportValidation.missingSections.join("、")}\n`,
    );
    console.error("💡 請補齊對應段落後重新執行 update-mr。\n");
    process.exit(1);
  }

  const skipReview = args.includes("--no-review");
  const reviewerArg = args.find((a) => a.startsWith("--reviewer="));
  const requestedReviewer = reviewerArg
    ? reviewerArg.split("=").slice(1).join("=").trim()
    : null;
  const labelsArg =
    args.find((a) => a.startsWith("--add-labels=")) ||
    args.find((a) => a.startsWith("--labels="));
  const requestedLabels = labelsArg
    ? labelsArg
        .split("=")
        .slice(1)
        .join("=")
        .split(",")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : [];

  const uncommitted = getGitStatus();
  if (uncommitted.length > 0) {
    console.error("\n❌ 檢測到未提交的變更，請先 commit 後再更新 MR\n");
    process.exit(1);
  }

  const currentBranch = getCurrentBranch();

  // 嘗試取得 MR（優先 glab）
  let mrIid = null;
  let mrDetails = null;

  if (hasGlab() && isGlabAuthenticated(hostname)) {
    mrIid = findExistingMRWithGlab(currentBranch);
    if (mrIid) {
      mrDetails = getMRDetailsWithGlab(mrIid);
    }
  }

  let token = getGitLabToken();
  if (!token) {
    const envLocal = loadEnvLocal();
    token = process.env.GITLAB_TOKEN || envLocal.GITLAB_TOKEN || null;
  }

  const projectInfo = getProjectInfo();

  if (!mrIid && token) {
    const mr = await findExistingMR(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      currentBranch
    );
    if (mr) {
      mrIid = mr.iid;
      mrDetails = await getMRDetails(
        token,
        projectInfo.host,
        projectInfo.projectPath,
        mrIid
      );
    }
  } else if (mrIid && !mrDetails && token) {
    mrDetails = await getMRDetails(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid
    );
  }

  if (!mrIid || !mrDetails) {
    console.error("\n❌ 找不到當前分支對應的已開啟 MR，無法更新\n");
    console.error(`🌿 分支: ${currentBranch}\n`);
    console.error("💡 若要建立新 MR，請改用 create-mr.mjs\n");
    process.exit(1);
  }

  // merge description（避免重複）
  const existingDescription =
    typeof mrDetails.description === "string" ? mrDetails.description : "";
  const reportForDescription = stripTrailingAgentSignature(externalReport);
  let mergedDescription = upsertDevelopmentReport(
    existingDescription,
    reportForDescription
  );
  // FE-8004: 署名必須為 MR description 的最後一行（可見內容）
  mergedDescription = appendAgentSignature(
    stripTrailingAgentSignature(mergedDescription)
  );

  // 更新 MR（使用 API token；若沒有 token，嘗試引導 glab token login）
  if (!token) {
    if (hasGlab() && !isGlabAuthenticated(hostname)) {
      console.error("\n❌ 未找到 GitLab token 且 glab 未登入，無法更新 MR\n");
      process.exit(1);
    }
    // 如果 glab 已登入但沒 token，仍可嘗試要求用戶輸入 token 以走 API（避免 glab update flags 差異）
    console.log(
      "\n🔐 請輸入 GitLab Personal Access Token 以更新 MR（需要 api 權限）\n"
    );
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    token = await new Promise((resolve) =>
      rl.question("Token: ", (t) => {
        rl.close();
        resolve(t.trim());
      })
    );
    if (!token) process.exit(1);
    try {
      if (hasGlab() && !isGlabAuthenticated(hostname)) {
        loginGlabWithToken(hostname, token);
      }
    } catch {
      // ignore
    }
  }

  // reviewer：只在用戶明確指定 --reviewer 時才更新（避免覆寫既有 reviewer）
  let reviewerId = null;
  if (requestedReviewer) {
    reviewerId = await findUserId(token, projectInfo.host, requestedReviewer);
    if (!reviewerId) {
      console.error(`\n❌ 找不到 reviewer: ${requestedReviewer}\n`);
      process.exit(1);
    }
    console.log(`\n👤 將更新 reviewer: ${requestedReviewer}\n`);
  }

  // 🚨 CRITICAL: update-mr 若要新增 labels，必須先通過 adapt.json 可用性白名單
  let labelsToAdd = [];
  if (requestedLabels.length > 0) {
    const adaptAllowedLabelSet = getAdaptAllowedLabelSet();
    const adaptCheck = filterLabelsByAdaptAllowed(
      requestedLabels,
      adaptAllowedLabelSet,
      "外部傳入（準備新增）",
    );
    labelsToAdd = adaptCheck.valid;

    if (labelsToAdd.length > 0) {
      console.log(`\n🏷️  將新增 labels: ${labelsToAdd.join(", ")}\n`);
    } else {
      console.log("\n🏷️  未提供任何可用 labels（或已全數被過濾），將略過 labels 更新\n");
    }
  }

  const updated = await updateMRDescription(
    token,
    projectInfo.host,
    projectInfo.projectPath,
    mrIid,
    mergedDescription,
    labelsToAdd,
    reviewerId
  );

  console.log("\n✅ MR 更新成功！\n");
  console.log(`🔗 MR 連結: [MR !${updated.iid}](${updated.web_url})`);
  console.log(`📊 MR ID: !${updated.iid}`);

  // AI review 規則（根源級）：
  // - 用戶可用 --no-review 明確跳過
  // - 未明確跳過時預設要送審，但前提是「MR head SHA 相對於上次已送審狀態」有變化
  // - 沒有 new commit 時不可送審（無繞過參數）
  if (skipReview) {
    console.log("\n⏭️  跳過 AI review（--no-review）\n");
    return;
  }

  // 若未配置 COMPASS_API_TOKEN，視為環境不支援 AI review：僅跳過送審，其餘流程照常
  // 並且不進行任何 new commit / SHA / marker 判斷（避免不必要的耦合）
  if (!getCompassApiToken()) {
    console.log("\n⏭️  跳過 AI review（缺少 COMPASS_API_TOKEN）\n");
    return;
  }

  const mrWebUrl = mrDetails?.web_url || updated?.web_url;
  const mrHeadSha = mrDetails?.diff_refs?.head_sha || mrDetails?.sha || null;
  if (!mrHeadSha) {
    console.error("\n❌ 無法取得 MR head SHA，無法判斷是否需要送審\n");
    process.exit(1);
  }

  // 取得上次已送審的 head sha（從 MR notes 的 marker）
  let lastReviewedSha = null;
  try {
    const notes = await listMrNotes(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid,
      100
    );
    for (const n of notes) {
      const sha = extractAiReviewShaFromText(n?.body);
      if (sha) {
        lastReviewedSha = sha;
        break;
      }
    }
  } catch {
    // ignore
  }

  if (lastReviewedSha && lastReviewedSha === mrHeadSha) {
    console.log(
      "\n⏭️  未偵測到 new commit（MR head SHA 與上次已送審 SHA 相同），跳過 AI review\n"
    );
    return;
  }

  // 送審前：要求本地 HEAD 已推送到 origin（避免對尚未推送的 commit 送審）
  try {
    exec(`git fetch origin ${currentBranch}`, { silent: true });
    const localHead = getLocalHeadSha();
    const originHead = getOriginHeadSha(currentBranch);
    if (originHead !== localHead) {
      console.error(
        "\n❌ 偵測到本地有新 commit 尚未推送，請先 push 後再更新/送審\n"
      );
      process.exit(1);
    }
  } catch {
    // ignore
  }

  if (!mrWebUrl) {
    console.error("\n❌ 無法取得 MR URL，無法提交 AI review\n");
    process.exit(1);
  }

  console.log("🤖 偵測到 new commit，正在提交 AI review...");
  try {
    await submitAIReview(mrWebUrl);
    console.log("✅ AI review 已提交\n");
  } catch (error) {
    console.error(`\n❌ AI review 提交失敗: ${error.message}\n`);
    process.exit(1);
  }

  try {
    await upsertAiReviewMarkerNote(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid,
      mrHeadSha
    );
    console.log(`🧷 已更新 AI_REVIEW_SHA 狀態: ${mrHeadSha}\n`);
  } catch (error) {
    console.error(`\n❌ 無法寫入 AI_REVIEW_SHA 狀態: ${error.message}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n❌ 發生錯誤: ${error.message}\n`);
  process.exit(1);
});

/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:20:23.330Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Updated only comment annotations: fixed duplicate/malformed external Jira references and normalized @external links to full Jira browse URLs per required three-section annotation layout, without changing runtime logic.
 */

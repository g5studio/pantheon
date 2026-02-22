#!/usr/bin/env node

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
import { existsSync, readFileSync, statSync, unlinkSync, rmSync } from "fs";
import { isAbsolute, join } from "path";
import readline from "readline";
import {
  getProjectRoot,
  loadEnvLocal,
  getGitLabToken,
  getCompassApiToken,
  getJiraEmail,
  getGitLabToken as getGitLabTokenFromEnvLoader,
} from "../utilities/env-loader.mjs";
import { determineLabels, readStartTaskInfo } from "./label-analyzer.mjs";
import {
  appendAgentSignature,
  stripTrailingAgentSignature,
} from "../utilities/agent-signature.mjs";
import { readAgentVersionInfo } from "../utilities/agent-version.mjs";

const projectRoot = getProjectRoot();

const DEFAULT_START_TASK_INFO_FILE = join(
  projectRoot,
  ".cursor",
  "tmp",
  "start-task-info.json",
);
const DEFAULT_DEVELOPMENT_PLAN_FILE = join(
  projectRoot,
  ".cursor",
  "tmp",
  "development-plan.md",
);
const DEFAULT_DEVELOPMENT_REPORT_FILE = join(
  projectRoot,
  ".cursor",
  "tmp",
  "development-report.md",
);

function generateAgentVersionSection(versionInfo) {
  if (!versionInfo || Object.keys(versionInfo).length === 0) {
    return null;
  }

  const lines = [
    "---",
    "",
    "### 🤖 Agent Version",
    "",
    "| Deity Agent | Version |",
    "|-------------|---------|",
  ];

  for (const [component, version] of Object.entries(versionInfo)) {
    lines.push(`| ${component} | ${version} |`);
  }

  return lines.join("\n");
}

function stripAgentVersionSectionFromDescription(description) {
  const base = typeof description === "string" ? description : "";
  const idx = base.lastIndexOf("### 🤖 Agent Version");
  if (idx === -1) return base;

  const start = Math.max(base.lastIndexOf("\n---", idx), idx);
  const before = base.slice(0, start).trimEnd();
  return before ? `${before}\n` : "";
}

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

function readUtf8FileFromProjectRoot(filePath) {
  const resolved = resolvePathFromProjectRoot(filePath);
  if (!resolved) return null;
  if (!existsSync(resolved)) {
    throw new Error(`找不到檔案: ${filePath}`);
  }
  return readFileSync(resolved, "utf-8").replace(/^\uFEFF/, "");
}

function tryReadUtf8FileFromProjectRoot(filePath) {
  try {
    return readUtf8FileFromProjectRoot(filePath);
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

function safeUnlink(filePath) {
  const resolved = resolvePathFromProjectRoot(filePath);
  if (!resolved) return false;
  try {
    if (!existsSync(resolved)) return false;
    unlinkSync(resolved);
    return true;
  } catch {
    return false;
  }
}

function safeRmStartTaskDir(dirPath, ticket) {
  if (!dirPath) return false;
  const resolved = resolvePathFromProjectRoot(dirPath);
  if (!resolved) return false;

  const tmpRoot = join(projectRoot, ".cursor", "tmp");
  const resolvedTmpRoot = resolvePathFromProjectRoot(tmpRoot);
  if (!resolvedTmpRoot) return false;

  // 只允許刪除 .cursor/tmp 之下的資料夾，且禁止刪除根目錄
  if (!resolved.startsWith(resolvedTmpRoot)) return false;
  if (resolved === resolvedTmpRoot) return false;

  // 只允許刪除 ticket 目錄（避免誤刪其他 ticket）
  const expectedTicketDir = ticket
    ? join(resolvedTmpRoot, ticket)
    : null;
  if (!expectedTicketDir || resolved !== expectedTicketDir) return false;

  try {
    rmSync(resolved, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function isSameTicket(a, b) {
  const ta = typeof a === "string" ? a.trim().toUpperCase() : "";
  const tb = typeof b === "string" ? b.trim().toUpperCase() : "";
  return !!ta && !!tb && ta === tb;
}

function extractTicketFromBranch(branchName) {
  return branchName?.match(/FE-\d+|IN-\d+/)?.[0] || "N/A";
}

function cleanupStartTaskArtifactsIfNeeded({
  enabled,
  ticket,
  startTaskInfo,
  startTaskInfoFile,
  developmentPlanFile,
  developmentReportFile,
} = {}) {
  if (!enabled) return;
  if (!startTaskInfo) return;
  if (!isSameTicket(startTaskInfo.ticket, ticket)) return;

  // FE-8006: 一律清除 `.cursor/tmp/{TICKET}/` 整個目錄（保留 --no-cleanup-start-task-artifacts 例外）
  const ticketDir = join(".cursor", "tmp", ticket);
  if (safeRmStartTaskDir(ticketDir, ticket)) {
    console.log("🧹 已清理 start-task 暫存資料夾：");
    console.log(`   - ${ticketDir}\n`);
    return;
  }

  const infoPath = startTaskInfoFile || DEFAULT_START_TASK_INFO_FILE;
  const planPath =
    developmentPlanFile ||
    startTaskInfo.developmentPlanFile ||
    DEFAULT_DEVELOPMENT_PLAN_FILE;
  const reportPath =
    developmentReportFile ||
    startTaskInfo.developmentReportFile ||
    DEFAULT_DEVELOPMENT_REPORT_FILE;

  const removed = [];
  if (safeUnlink(reportPath)) removed.push(reportPath);
  if (safeUnlink(planPath)) removed.push(planPath);
  if (safeUnlink(infoPath)) removed.push(infoPath);

  if (removed.length > 0) {
    console.log("🧹 已清理 start-task 暫存檔案：");
    removed.forEach((p) => console.log(`   - ${p}`));
    console.log("");
  }
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

function findExistingMRWithGlab(sourceBranch) {
  try {
    const result = exec(
      `glab mr list --source-branch ${sourceBranch} --state opened`,
      { silent: true },
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
      sourceBranch,
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
  labels = null,
) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;
  const body = { description };
  if (Array.isArray(labels) && labels.length > 0) {
    body.labels = labels.join(",");
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

function hasMarkdownTable(content, expectedHeaderLine) {
  if (!content) return false;
  const headerIdx = content.indexOf(expectedHeaderLine);
  if (headerIdx === -1) return false;
  const afterHeader = content.slice(headerIdx);
  return afterHeader.includes("\n|---|") && /(\n\|.+\|)/.test(afterHeader);
}

function validateMrDescriptionFormat(description, startTaskInfo) {
  const desc = typeof description === "string" ? description : "";
  const missing = [];

  if (
    !desc.includes("## 📋 關聯單資訊") ||
    !hasMarkdownTable(desc, "| 項目 | 值 |")
  ) {
    missing.push("## 📋 關聯單資訊（含表格）");
  }
  if (!desc.includes("## 📝 變更摘要")) {
    missing.push("## 📝 變更摘要");
  }
  if (
    !desc.includes("### 變更內容") ||
    !hasMarkdownTable(desc, "| 檔案 | 狀態 | 說明 |")
  ) {
    missing.push("### 變更內容（含檔案表格：| 檔案 | 狀態 | 說明 |）");
  }
  if (
    !desc.includes("## ⚠️ 風險評估") ||
    !hasMarkdownTable(desc, "| 檔案 | 風險等級 | 評估說明 |")
  ) {
    missing.push("## ⚠️ 風險評估（含表格：| 檔案 | 風險等級 | 評估說明 |）");
  }

  const issueType = startTaskInfo?.issueType;
  const isBug =
    typeof issueType === "string" && issueType.toLowerCase().includes("bug");
  if (isBug) {
    if (!desc.includes("## 影響範圍"))
      missing.push("## 影響範圍（Bug 類型必須）");
    if (!desc.includes("## 根本原因"))
      missing.push("## 根本原因（Bug 類型必須）");
  }

  return { ok: missing.length === 0, missing, isBug };
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
  headSha,
) {
  const notes = await listMrNotes(token, host, projectPath, mrIid, 100);
  const body = appendAgentSignature(buildAiReviewMarkerBody(headSha));
  const existing = notes.find(
    (n) =>
      typeof n.body === "string" && n.body.includes(AI_REVIEW_MARKER_PREFIX),
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

  // start-task 相關參數（供上層 start-task 流程控制；update-mr 本身不做任何互動）
  const startTaskInfoFileArg = args.find((a) =>
    a.startsWith("--start-task-info-file="),
  );
  const developmentPlanFileArg = args.find((a) =>
    a.startsWith("--development-plan-file="),
  );
  const developmentReportFileArg = args.find((a) =>
    a.startsWith("--development-report-file="),
  );
  const startTaskInfoFile = startTaskInfoFileArg
    ? startTaskInfoFileArg.split("=").slice(1).join("=")
    : null;
  const developmentPlanFile = developmentPlanFileArg
    ? developmentPlanFileArg.split("=").slice(1).join("=")
    : null;
  const developmentReportFile = developmentReportFileArg
    ? developmentReportFileArg.split("=").slice(1).join("=")
    : null;

  const cleanupStartTaskArtifactsEnabled = !args.includes(
    "--no-cleanup-start-task-artifacts",
  );

  const reportArg = args.find((a) => a.startsWith("--development-report="));
  let externalReport = reportArg
    ? normalizeExternalMarkdownArg(reportArg.split("=").slice(1).join("="))
    : null;

  // 若未提供 --development-report，嘗試讀取檔案：
  // 1) --development-report-file
  // 2) 預設 .cursor/tmp/development-report.md
  if (!externalReport || !externalReport.trim()) {
    const reportPath = developmentReportFile || DEFAULT_DEVELOPMENT_REPORT_FILE;
    const reportMarkdown = tryReadUtf8FileFromProjectRoot(reportPath);
    if (reportMarkdown && reportMarkdown.trim()) {
      externalReport = reportMarkdown.trim();
    }
  }

  if (!externalReport || !externalReport.trim()) {
    console.error("\n❌ update-mr 需要提供開發報告\n");
    console.error("✅ 請擇一提供：");
    console.error('   1) --development-report="<markdown>"');
    console.error("   2) --development-report-file=<path>");
    console.error(`   3) ${DEFAULT_DEVELOPMENT_REPORT_FILE}\n`);
    process.exit(1);
  }

  const skipReview = args.includes("--no-review");

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
      currentBranch,
    );
    if (mr) {
      mrIid = mr.iid;
      mrDetails = await getMRDetails(
        token,
        projectInfo.host,
        projectInfo.projectPath,
        mrIid,
      );
    }
  } else if (mrIid && !mrDetails && token) {
    mrDetails = await getMRDetails(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid,
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
  let mergedDescription = upsertDevelopmentReport(existingDescription, externalReport);

  // FE-8006:
  // - Agent Version 需「一定呈現在報告中」
  // - 署名需為 MR description 的最後一行（可見內容）
  mergedDescription = stripAgentVersionSectionFromDescription(mergedDescription);
  const agentVersionInfoAuto = readAgentVersionInfo() || {};
  const agentVersionSection = generateAgentVersionSection(
    Object.keys(agentVersionInfoAuto).length > 0
      ? agentVersionInfoAuto
      : { pantheon: "N/A" }
  );
  if (agentVersionSection && !mergedDescription.includes("### 🤖 Agent Version")) {
    mergedDescription = `${mergedDescription.trimEnd()}\n\n${agentVersionSection}\n`;
  }
  mergedDescription = appendAgentSignature(mergedDescription);

  // 格式驗證（回歸檢查）
  const ticket = extractTicketFromBranch(currentBranch);
  const startTaskInfo = readStartTaskInfo({ startTaskInfoFile });
  const validation = validateMrDescriptionFormat(
    mergedDescription,
    startTaskInfo,
  );
  if (!validation.ok) {
    console.error(
      "\n❌ MR description 開發報告格式不符合規範，已中止更新 MR\n",
    );
    console.error("📋 缺少以下必要區塊：");
    validation.missing.forEach((m) => console.error(`- ${m}`));
    console.error("");
    process.exit(1);
  }

  // AI label：僅在「同 ticket 且存在 AI plan/report 檔案」時才追加（不移除既有 AI label）
  let nextLabels = null;
  try {
    const existingLabels = Array.isArray(mrDetails.labels)
      ? [...mrDetails.labels]
      : [];
    const labelResult = await determineLabels(ticket, {
      startTaskInfo,
      startTaskInfoFile,
      developmentPlanFile,
      developmentReportFile,
    });
    const shouldHaveAi = labelResult.labels.includes("AI");
    if (shouldHaveAi && !existingLabels.includes("AI")) {
      existingLabels.push("AI");
    }
    if (existingLabels.length > 0) {
      nextLabels = existingLabels;
    }
  } catch {
    // ignore label failures (do not block update)
  }

  // 更新 MR（使用 API token；若沒有 token，嘗試引導 glab token login）
  if (!token) {
    if (hasGlab() && !isGlabAuthenticated(hostname)) {
      console.error("\n❌ 未找到 GitLab token 且 glab 未登入，無法更新 MR\n");
      process.exit(1);
    }
    // 如果 glab 已登入但沒 token，仍可嘗試要求用戶輸入 token 以走 API（避免 glab update flags 差異）
    console.log(
      "\n🔐 請輸入 GitLab Personal Access Token 以更新 MR（需要 api 權限）\n",
    );
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    token = await new Promise((resolve) =>
      rl.question("Token: ", (t) => {
        rl.close();
        resolve(t.trim());
      }),
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

  const updated = await updateMRDescription(
    token,
    projectInfo.host,
    projectInfo.projectPath,
    mrIid,
    mergedDescription,
    nextLabels,
  );

  console.log("\n✅ MR 更新成功！\n");
  console.log(`🔗 MR 連結: [MR !${updated.iid}](${updated.web_url})`);
  console.log(`📊 MR ID: !${updated.iid}`);

  // cleanup：MR description/labels 更新成功後才清理（失敗則保留以便重跑）
  cleanupStartTaskArtifactsIfNeeded({
    enabled: cleanupStartTaskArtifactsEnabled,
    ticket,
    startTaskInfo,
    startTaskInfoFile,
    developmentPlanFile,
    developmentReportFile,
  });

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
      100,
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
      "\n⏭️  未偵測到 new commit（MR head SHA 與上次已送審 SHA 相同），跳過 AI review\n",
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
        "\n❌ 偵測到本地有新 commit 尚未推送，請先 push 後再更新/送審\n",
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
      mrHeadSha,
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

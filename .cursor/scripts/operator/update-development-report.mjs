#!/usr/bin/env node

/**
 * 更新開發報告到 Git notes
 *
 * 此腳本用於在開發完成後，將開發報告保存到 Git notes 中的 startTaskInfo，
 * 以便在建立 MR 時檢附到 MR description。
 *
 * 使用方式：
 *   node .cursor/scripts/operator/update-development-report.mjs --report="<report-content>"
 *   node .cursor/scripts/operator/update-development-report.mjs --report-file="<path-to-report-file>"
 *   node .cursor/scripts/operator/update-development-report.mjs --read  # 讀取當前的開發報告
 *   node .cursor/scripts/operator/update-development-report.mjs --format  # 輸出格式化的 MR description
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  getProjectRoot,
  loadEnvLocal,
  getCompassApiToken,
} from "../utilities/env-loader.mjs";
import { callOpenAiJson, resolveLlmModel } from "../utilities/llm-client.mjs";

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

function readTextIfExists(filePath) {
  try {
    if (!filePath) return null;
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function resolvePantheonFilePath(relativePathFromRoot) {
  const candidates = [
    join(projectRoot, ".pantheon", relativePathFromRoot),
    join(projectRoot, relativePathFromRoot),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function extractDevelopmentReportRulesText(commitAndMrGuidelinesText) {
  const text = String(commitAndMrGuidelinesText || "");
  if (!text.trim()) return "";

  const start = text.indexOf("### Development Report Requirement");
  if (start < 0) return text;

  // keep the most relevant part, but avoid bringing the entire file into the prompt
  const tail = text.slice(start);
  const maxChars = 22000;
  return tail.length > maxChars ? tail.slice(0, maxChars) : tail;
}

function getRelevantRulesText() {
  const commitAndMrPath = resolvePantheonFilePath(
    join(".cursor", "rules", "cr", "commit-and-mr-guidelines.mdc"),
  );
  const commitAndMrText = readTextIfExists(commitAndMrPath) || "";

  const extracted = extractDevelopmentReportRulesText(commitAndMrText);
  const commitAndMrRules = extracted.trim() ? extracted : commitAndMrText;

  const startTaskCommandPath = resolvePantheonFilePath(
    join(".cursor", "commands", "operator", "start-task.md"),
  );
  const startTaskCommandText = readTextIfExists(startTaskCommandPath) || "";

  const startTaskTemplate = extractStartTaskDevelopmentReportTemplateText(
    startTaskCommandText,
  );

  const parts = [];
  if (commitAndMrRules.trim()) {
    parts.push("## 規範來源：commit-and-mr-guidelines.mdc（摘錄）");
    parts.push(commitAndMrRules.trim());
  }
  if (startTaskTemplate.trim()) {
    parts.push("## 規範來源：start-task.md（開發報告範本摘錄）");
    parts.push(startTaskTemplate.trim());
  }

  return parts.filter(Boolean).join("\n\n");
}

function getCurrentChangeSnapshot() {
  const snapshot = {};

  try {
    snapshot.branch = exec("git rev-parse --abbrev-ref HEAD", {
      silent: true,
    }).trim();
  } catch {
    snapshot.branch = "unknown";
  }

  let baseCommit = null;
  try {
    baseCommit = exec("git merge-base HEAD main", { silent: true }).trim();
  } catch {
    baseCommit = null;
  }
  snapshot.baseCommit = baseCommit;

  try {
    snapshot.statusPorcelain = exec("git status --porcelain", {
      silent: true,
    });
  } catch {
    snapshot.statusPorcelain = "";
  }

  const rangeTripleDot = baseCommit ? `${baseCommit}...HEAD` : null;
  try {
    snapshot.diffNameStatus = rangeTripleDot
      ? exec(`git diff --name-status ${rangeTripleDot}`, { silent: true })
      : exec("git diff --name-status", { silent: true });
  } catch {
    snapshot.diffNameStatus = "";
  }

  try {
    snapshot.diffStat = rangeTripleDot
      ? exec(`git diff --stat ${rangeTripleDot}`, { silent: true })
      : exec("git diff --stat", { silent: true });
  } catch {
    snapshot.diffStat = "";
  }

  try {
    snapshot.commits = baseCommit
      ? exec(`git log --oneline ${baseCommit}..HEAD`, { silent: true })
      : exec("git log -n 30 --oneline", { silent: true });
  } catch {
    snapshot.commits = "";
  }

  return snapshot;
}

function extractStartTaskDevelopmentReportTemplateText(startTaskCommandText) {
  const text = String(startTaskCommandText || "");
  if (!text.trim()) return "";

  const startCandidates = [
    "### 🧾 開發報告格式範例（CRITICAL）",
    "🧾 開發報告格式範例",
    "Request 特有區塊固定模板",
  ];
  let start = -1;
  for (const s of startCandidates) {
    const i = text.indexOf(s);
    if (i >= 0) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";

  const endCandidates = ["**使用方式：**", "**執行範例：**", "## "];
  let end = -1;
  for (const e of endCandidates) {
    const i = text.indexOf(e, start + 1);
    if (i >= 0) {
      end = i;
      break;
    }
  }
  const slice = end > start ? text.slice(start, end) : text.slice(start);

  const maxChars = 22000;
  return slice.length > maxChars ? slice.slice(0, maxChars) : slice;
}

function coerceJsonObjectFromModel(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("LLM 回傳為空");

  try {
    return JSON.parse(trimmed);
  } catch {}

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    return JSON.parse(slice);
  }

  throw new Error("無法從 LLM 回傳中解析 JSON");
}

async function callCompassOperatorProxyJson({
  model,
  system,
  input,
  schema,
  schemaName = "structured_output",
}) {
  const token = getCompassApiToken();
  if (!token) {
    throw new Error(
      "缺少 LLM 認證（請設定 OPENAI_API_KEY 或 COMPASS_API_TOKEN）",
    );
  }

  const url =
    process.env.COMPASS_OPERATOR_PROXY_URL ||
    "https://mac09demac-mini.balinese-python.ts.net/api/workflows/operator-proxy";

  const requestBody = {
    provider: "openai",
    model,
    system: String(system || ""),
    content: JSON.stringify(input),
  };
  if (schema && typeof schema === "object") {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: {
        name: String(schemaName || "structured_output"),
        strict: true,
        schema,
      },
    };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": token,
    },
    body: JSON.stringify(requestBody),
  });

  const rawText = await resp.text().catch(() => "");
  let json = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const msg =
      (json && typeof json.error === "string" && json.error.trim()) ||
      rawText ||
      resp.statusText ||
      "Unknown error";
    throw new Error(`Compass operator-proxy 失敗: ${resp.status} ${msg}`.trim());
  }

  if (!json || typeof json !== "object") {
    throw new Error("Compass operator-proxy 回傳格式錯誤（非 JSON）");
  }
  if (json.ok !== true) {
    const msg = typeof json.error === "string" ? json.error : "Unknown error";
    throw new Error(`Compass operator-proxy 失敗: ${msg}`.trim());
  }

  const resultText =
    typeof json?.result === "string" ? String(json.result) : "";
  return coerceJsonObjectFromModel(resultText);
}

async function reviewDevelopmentReportWithLlm({ reportContent, startTaskInfo }) {
  const rulesText = getRelevantRulesText();
  const changeSnapshot = getCurrentChangeSnapshot();
  const envLocal = loadEnvLocal();

  const model = resolveLlmModel({
    explicitModel: null,
    envLocal,
    envKeys: ["OPERATOR_LLM_MODEL", "LLM_MODEL", "OPENAI_MODEL"],
    defaultModel: "gpt-5.2",
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "final", "reason"],
    properties: {
      ok: { type: "boolean" },
      final: { type: "string" },
      reason: { type: "string" },
    },
  };

  const system = [
    "你是一個嚴格的 MR 開發報告審查器。",
    "請根據輸入的規範文字（rules）以及當前異動摘要（changes），檢查 report 是否符合規範、是否包含必要區塊與表格、且內容與 changes 一致。",
    "你必須回傳 JSON，格式為：{ ok: boolean, final: string, reason: string }。",
    "- ok=true：代表原始 report 已符合規範，此時 final 必須等於原始 report（不可改寫）。",
    "- ok=false：代表原始 report 不符合規範或與 changes 不一致；你必須在 final 內輸出「已修正且符合規範」的 report（Markdown 內容），並保留語言為繁體中文。",
    "- reason：必填。請用條列摘要說明檢查重點：缺哪些區塊/表格、與 changes 不一致處、以及你做了哪些修正（若 ok=true 則說明為何判定通過）。",
    "輸出不得包含任何額外文字、不得用 Markdown code fence 包住 JSON。",
  ].join("\n");

  const input = {
    report: String(reportContent || ""),
    rules: String(rulesText || ""),
    changes: changeSnapshot,
    startTaskInfo: startTaskInfo
      ? {
          ticket: startTaskInfo.ticket ?? null,
          summary: startTaskInfo.summary ?? null,
          issueType: startTaskInfo.issueType ?? null,
        }
      : null,
  };

  try {
    const obj = await callOpenAiJson({
      model,
      system,
      input,
      temperature: 0.1,
      schema,
      schemaName: "development_report_review",
    });

    if (
      typeof obj?.ok !== "boolean" ||
      typeof obj?.final !== "string" ||
      typeof obj?.reason !== "string"
    ) {
      throw new Error("LLM 回傳格式錯誤（缺少 ok/final/reason）");
    }
    return obj;
  } catch (error) {
    // fallback to Compass operator-proxy if OpenAI key missing / OpenAI API is unavailable
    const msg = String(error?.message || "");
    const shouldFallback =
      msg.includes("缺少 OpenAI API key") ||
      msg.includes("OpenAI API 失敗") ||
      msg.includes("fetch failed");

    if (!shouldFallback) throw error;

    const obj = await callCompassOperatorProxyJson({
      model,
      system,
      input,
      schema,
      schemaName: "development_report_review",
    });
    if (
      typeof obj?.ok !== "boolean" ||
      typeof obj?.final !== "string" ||
      typeof obj?.reason !== "string"
    ) {
      throw new Error("LLM 回傳格式錯誤（缺少 ok/final/reason）");
    }
    return obj;
  }
}

// 讀取 start-task 開發計劃（從 Git notes）
function readStartTaskInfo() {
  try {
    // 首先嘗試讀取當前 HEAD 的 Git notes
    const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();
    try {
      const noteContent = exec(
        `git notes --ref=start-task show ${currentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return { info: JSON.parse(noteContent), commit: currentCommit };
      }
    } catch (error) {
      // 當前 commit 沒有 Git notes，繼續嘗試其他位置
    }

    // 嘗試從父 commit 讀取
    try {
      const parentCommit = exec("git rev-parse HEAD^", { silent: true }).trim();
      const noteContent = exec(
        `git notes --ref=start-task show ${parentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return { info: JSON.parse(noteContent), commit: parentCommit };
      }
    } catch (error) {
      // 父 commit 沒有 Git notes，繼續嘗試
    }

    // 嘗試從分支的 base commit 讀取
    try {
      const baseCommit = exec("git merge-base HEAD main", {
        silent: true,
      }).trim();
      const noteContent = exec(
        `git notes --ref=start-task show ${baseCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return { info: JSON.parse(noteContent), commit: baseCommit };
      }
    } catch (error) {
      // base commit 沒有 Git notes
    }

    return null;
  } catch (error) {
    return null;
  }
}

// 更新 Git notes 中的 startTaskInfo
function updateStartTaskInfo(startTaskInfo) {
  try {
    const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();
    const noteContent = JSON.stringify(startTaskInfo, null, 2);

    const result = spawnSync(
      "git",
      ["notes", "--ref=start-task", "add", "-f", "-F", "-", currentCommit],
      {
        cwd: projectRoot,
        input: noteContent,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    if (result.status === 0) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// 生成格式化的 MR description（使用表格格式）
function formatMrDescription(startTaskInfo) {
  const sections = [];

  // 開發計劃部分
  if (startTaskInfo.suggestedSteps && startTaskInfo.suggestedSteps.length > 0) {
    const planSection = [
      "## 🎯 開發計劃",
      "",
      "本 MR 由 `start-task` 命令啟動，以下是初步制定的開發計劃：",
      "",
      ...startTaskInfo.suggestedSteps.map((step) => `- ${step}`),
      "",
      "| 項目 | 值 |",
      "|---|---|",
      `| **Jira Ticket** | ${startTaskInfo.ticket} |`,
      `| **標題** | ${startTaskInfo.summary} |`,
      `| **類型** | ${startTaskInfo.issueType} |`,
      `| **狀態** | ${startTaskInfo.status || "未知"} |`,
      `| **負責人** | ${startTaskInfo.assignee || "未分配"} |`,
      `| **優先級** | ${startTaskInfo.priority || "未設置"} |`,
      `| **啟動時間** | ${new Date(startTaskInfo.startedAt).toLocaleString(
        "zh-TW"
      )} |`,
    ].join("\n");

    sections.push(planSection);
  }

  // 開發報告部分
  if (startTaskInfo.developmentReport) {
    const reportSection = [
      "",
      "---",
      "",
      "## 📊 開發報告",
      "",
      startTaskInfo.developmentReport,
    ].join("\n");

    sections.push(reportSection);
  }

  return sections.join("\n");
}

// 主函數
async function main() {
  const args = process.argv.slice(2);

  // 解析參數
  let reportContent = null;
  let reportFile = null;
  let readMode = false;
  let formatMode = false;

  for (const arg of args) {
    if (arg.startsWith("--report=")) {
      reportContent = arg.slice("--report=".length);
    } else if (arg.startsWith("--report-file=")) {
      reportFile = arg.slice("--report-file=".length);
    } else if (arg === "--read") {
      readMode = true;
    } else if (arg === "--format") {
      formatMode = true;
    }
  }

  // 讀取模式：輸出當前的 startTaskInfo
  if (readMode) {
    const result = readStartTaskInfo();
    if (result) {
      console.log(JSON.stringify(result.info, null, 2));
    } else {
      console.error("❌ 找不到 start-task Git notes");
      process.exit(1);
    }
    return;
  }

  // 格式化模式：輸出格式化的 MR description
  if (formatMode) {
    const result = readStartTaskInfo();
    if (result) {
      console.log(formatMrDescription(result.info));
    } else {
      console.error("❌ 找不到 start-task Git notes");
      process.exit(1);
    }
    return;
  }

  // 從檔案讀取報告內容
  if (reportFile) {
    if (!existsSync(reportFile)) {
      console.error(`❌ 找不到報告檔案: ${reportFile}`);
      process.exit(1);
    }
    reportContent = readFileSync(reportFile, "utf-8");
  }

  // 更新模式：更新開發報告
  if (reportContent) {
    const result = readStartTaskInfo();
    if (!result) {
      console.error("❌ 找不到 start-task Git notes，無法更新開發報告");
      process.exit(1);
    }

    const startTaskInfo = result.info;

    // 先送 LLM 複查（report + 規範 + 當前異動內容），依 ok 決定採用原文或修正版
    let finalReport = reportContent;
    try {
      const review = await reviewDevelopmentReportWithLlm({
        reportContent,
        startTaskInfo,
      });
      const reason = String(review.reason || "").trim();
      if (reason) {
        console.log("\n🧾 LLM 複查原因（reason）：\n");
        console.log(reason);
        console.log("");
      }
      if (review.ok === true) {
        if (review.final !== reportContent) {
          console.log(
            "⚠️ LLM 回 ok=true 但 final 與原始內容不同，已忽略 final 並使用原始開發報告",
          );
        }
        finalReport = reportContent;
        console.log("✅ LLM 複查通過（ok=true），將使用原始開發報告");
      } else {
        if (!review.final.trim()) {
          throw new Error("LLM 回 ok=false 但 final 為空，無法套用修正版");
        }
        finalReport = review.final;
        console.log("⚠️ LLM 複查未通過（ok=false），將改用 LLM 修正版開發報告");
      }
    } catch (error) {
      console.error("❌ LLM 複查失敗，已停止更新（避免寫入未審查內容）");
      console.error(`錯誤: ${error.message}`);
      process.exit(1);
    }

    startTaskInfo.developmentReport = finalReport;

    if (updateStartTaskInfo(startTaskInfo)) {
      console.log("✅ 已更新開發報告到 Git notes");
      console.log("\n📋 開發報告已保存，建立 MR 時將自動檢附到 MR description");
    } else {
      console.error("❌ 更新開發報告失敗");
      process.exit(1);
    }
    return;
  }

  // 顯示使用說明
  console.log(`
📝 開發報告更新工具

使用方式：
  node .cursor/scripts/operator/update-development-report.mjs --report="<report-content>"
  node .cursor/scripts/operator/update-development-report.mjs --report-file="<path-to-report-file>"
  node .cursor/scripts/operator/update-development-report.mjs --read
  node .cursor/scripts/operator/update-development-report.mjs --format

參數說明：
  --report="..."      直接提供報告內容
  --report-file="..." 從檔案讀取報告內容
  --read              讀取當前的 startTaskInfo
  --format            輸出格式化的 MR description（Markdown 格式）
`);
}

main().catch((error) => {
  console.error("❌ 執行失敗");
  console.error(`錯誤: ${error?.message || error}`);
  process.exit(1);
});

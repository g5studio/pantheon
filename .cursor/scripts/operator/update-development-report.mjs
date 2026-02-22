#!/usr/bin/env node

/**
 * 更新開發報告到 `.cursor/tmp/{ticket}/merge-request-description-info.json`
 *
 * 此腳本用於在開發完成後，將「開發報告（markdown）」解析為 JSON，
 * 並寫入 `merge-request-description-info.json` 的 `report` 區塊，供 create-mr / update-mr
 * 依固定模板渲染到 MR description。
 *
 * 使用方式：
 *   node .cursor/scripts/operator/update-development-report.mjs --report="<report-content>"
 *   node .cursor/scripts/operator/update-development-report.mjs --report-file="<path-to-report-file>"
 *   node .cursor/scripts/operator/update-development-report.mjs --read [--ticket=IN-1234]
 *   node .cursor/scripts/operator/update-development-report.mjs --format [--ticket=IN-1234]
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { getProjectRoot } from "../utilities/env-loader.mjs";
import {
  createDefaultMergeRequestDescriptionInfoJson,
  ensureTmpDir,
  getMergeRequestDescriptionInfoJsonPath,
  normalizeMergeRequestDescriptionInfoJson,
  parseDevelopmentReportMarkdownToJson,
  readJsonIfExists,
  renderMergeRequestDescriptionInfoMarkdown,
  toJiraTicketUrl,
  writeJsonFile,
} from "../cr/development-docs.mjs";

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

function getTicketFromCurrentBranch() {
  try {
    const branch = exec("git branch --show-current", { silent: true }).trim();
    const match = branch.match(/([A-Z0-9]+-\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// 主函數
function main() {
  const args = process.argv.slice(2);

  // 解析參數
  let reportContent = null;
  let reportFile = null;
  let readMode = false;
  let formatMode = false;
  let ticket = null;

  for (const arg of args) {
    if (arg.startsWith("--ticket=")) {
      ticket = arg.slice("--ticket=".length).trim().toUpperCase();
      continue;
    }
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

  ticket = ticket || getTicketFromCurrentBranch();
  if (!ticket || !/^[A-Z0-9]+-\d+$/.test(ticket)) {
    console.error("❌ 缺少或無法推導 ticket，請提供 --ticket=FE-1234");
    process.exit(1);
  }

  // 從檔案讀取報告內容
  if (reportFile) {
    if (!existsSync(reportFile)) {
      console.error(`❌ 找不到報告檔案: ${reportFile}`);
      process.exit(1);
    }
    reportContent = readFileSync(reportFile, "utf-8");
  }

  const jiraTicketUrl = toJiraTicketUrl(ticket);
  const infoPath = getMergeRequestDescriptionInfoJsonPath(ticket);
  const existing = readJsonIfExists(infoPath);
  const base =
    existing ||
    createDefaultMergeRequestDescriptionInfoJson({ ticket, jiraTicketUrl });

  // 讀取模式：輸出當前的 JSON
  if (readMode) {
    if (!existing) {
      console.error("❌ 找不到 merge-request-description-info.json");
      process.exit(1);
    }
    console.log(JSON.stringify(existing, null, 2));
    return;
  }

  // 格式化模式：輸出固定模板渲染結果（不落地任何 md）
  if (formatMode) {
    const info = normalizeMergeRequestDescriptionInfoJson(
      { ...base, ticket, jiraTicketUrl },
      { changeFiles: [] }
    );
    console.log(renderMergeRequestDescriptionInfoMarkdown(info, { changeFiles: [] }));
    return;
  }

  // 更新模式：更新 report（由 markdown 解析）
  if (reportContent) {
    ensureTmpDir(ticket);
    const reportJson = parseDevelopmentReportMarkdownToJson(reportContent, ticket);
    const merged = normalizeMergeRequestDescriptionInfoJson(
      {
        ...base,
        ticket,
        jiraTicketUrl,
        report: reportJson,
      },
      { changeFiles: [] }
    );

    writeJsonFile(infoPath, merged);
    console.log("✅ 已更新開發報告（report）到 merge-request-description-info.json");
    console.log(`📍 Path: ${infoPath}`);
    return;
  }

  // 顯示使用說明
  console.log(`
📝 開發報告更新工具

使用方式：
  node .cursor/scripts/operator/update-development-report.mjs --report="<report-content>"
  node .cursor/scripts/operator/update-development-report.mjs --report-file="<path-to-report-file>"
  node .cursor/scripts/operator/update-development-report.mjs --read [--ticket=IN-1234]
  node .cursor/scripts/operator/update-development-report.mjs --format [--ticket=IN-1234]

參數說明：
  --ticket=...        Jira ticket（可省略：會嘗試從分支推導）
  --report="..."      直接提供報告內容
  --report-file="..." 從檔案讀取報告內容
  --read              讀取目前的 merge-request-description-info.json（JSON 格式）
  --format            輸出固定模板渲染後的 MR description（Markdown；不落地檔案）
`);
}

main();

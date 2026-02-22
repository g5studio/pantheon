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
import { getProjectRoot } from "../utilities/env-loader.mjs";

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
function main() {
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
    startTaskInfo.developmentReport = reportContent;

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
  --read              讀取當前的 startTaskInfo（JSON 格式）
  --format            輸出格式化的 MR description（Markdown 格式）
`);
}

main();

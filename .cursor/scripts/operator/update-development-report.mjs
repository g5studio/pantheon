#!/usr/bin/env node

/**
 * 更新開發報告到 .cursor/tmp（檔案化）
 *
 * 此腳本用於在開發完成後，將開發報告保存到 .cursor/tmp 的實體檔案中，
 * 並同步更新 start-task-info.json（aiDevelopmentReport / updatedAt 等欄位），
 * 以便在建立 / 更新 MR 時由 create-mr / update-mr 透過參數讀取並檢附。
 *
 * 使用方式：
 *   node .cursor/scripts/operator/update-development-report.mjs --report="<report-content>"
 *   node .cursor/scripts/operator/update-development-report.mjs --report-file="<path-to-report-file>"
 *   node .cursor/scripts/operator/update-development-report.mjs --ticket="FE-1234" --report-file="..."
 *   node .cursor/scripts/operator/update-development-report.mjs --start-task-dir=".cursor/tmp/FE-1234" --report-file="..."
 *   node .cursor/scripts/operator/update-development-report.mjs --start-task-info-file=".cursor/tmp/FE-1234/start-task-info.json" --report-file="..."
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { isAbsolute, join } from "path";
import { getProjectRoot } from "../utilities/env-loader.mjs";
import { appendAgentSignature } from "../utilities/agent-signature.mjs";

const projectRoot = getProjectRoot();

function resolvePathFromProjectRoot(filePath) {
  if (!filePath) return null;
  return isAbsolute(filePath) ? filePath : join(projectRoot, filePath);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveStartTaskPaths({ ticket, startTaskDir, startTaskInfoFile } = {}) {
  const dir = startTaskDir
    ? resolvePathFromProjectRoot(startTaskDir)
    : ticket
      ? join(projectRoot, ".cursor", "tmp", ticket)
      : null;

  const infoFile = startTaskInfoFile
    ? resolvePathFromProjectRoot(startTaskInfoFile)
    : dir
      ? join(dir, "start-task-info.json")
      : join(projectRoot, ".cursor", "tmp", "start-task-info.json");

  const reportFile = dir ? join(dir, "development-report.md") : null;
  return { dir, infoFile, reportFile };
}

// 主函數
function main() {
  const args = process.argv.slice(2);

  // 解析參數
  let reportContent = null;
  let reportFile = null;
  let ticket = null;
  let startTaskDir = null;
  let startTaskInfoFile = null;
  let confirmed = null; // RD confirmed 開發報告（resultVerified）

  for (const arg of args) {
    if (arg.startsWith("--report=")) {
      reportContent = arg.slice("--report=".length);
    } else if (arg.startsWith("--report-file=")) {
      reportFile = arg.slice("--report-file=".length);
    } else if (arg.startsWith("--ticket=")) {
      ticket = arg.slice("--ticket=".length).trim().toUpperCase();
    } else if (arg.startsWith("--start-task-dir=")) {
      startTaskDir = arg.slice("--start-task-dir=".length);
    } else if (arg.startsWith("--start-task-info-file=")) {
      startTaskInfoFile = arg.slice("--start-task-info-file=".length);
    } else if (arg.startsWith("--confirmed=")) {
      const v = arg.slice("--confirmed=".length).trim().toLowerCase();
      confirmed = v === "true" ? true : v === "false" ? false : null;
    } else if (arg.startsWith("--report-confirmed=")) {
      const v = arg.slice("--report-confirmed=".length).trim().toLowerCase();
      confirmed = v === "true" ? true : v === "false" ? false : null;
    }
  }

  // 從檔案讀取報告內容
  if (reportFile) {
    if (!existsSync(reportFile)) {
      console.error(`❌ 找不到報告檔案: ${reportFile}`);
      process.exit(1);
    }
    reportContent = readFileSync(reportFile, "utf-8");
  }

  // 允許「只更新 confirmed 狀態」而不改 report 內容
  if (reportContent || confirmed !== null) {
    const { infoFile, reportFile: defaultReportFile } = resolveStartTaskPaths({
      ticket,
      startTaskDir,
      startTaskInfoFile,
    });

    if (!existsSync(infoFile)) {
      console.error(`❌ 找不到 start-task-info.json：${infoFile}`);
      process.exit(1);
    }

    const raw = readFileSync(infoFile, "utf-8").replace(/^\uFEFF/, "").trim();
    const startTaskInfo = safeJsonParse(raw);
    if (!startTaskInfo) {
      console.error(`❌ start-task-info.json 解析失敗：${infoFile}`);
      process.exit(1);
    }

    if (reportContent) {
      const reportOut = startTaskInfo.developmentReportFile
        ? resolvePathFromProjectRoot(startTaskInfo.developmentReportFile)
        : defaultReportFile;
      if (!reportOut) {
        console.error("❌ 無法推斷 development-report.md 路徑");
        process.exit(1);
      }

      // FE-8006: 若設定 AGENT_DISPLAY_NAME，開發報告末尾追加署名（idempotent & 署名為最後一行）
      const reportWithSignature = appendAgentSignature(reportContent);
      writeFileSync(reportOut, reportWithSignature, "utf-8");
      startTaskInfo.aiDevelopmentReport = true;
      console.log("✅ 已更新開發報告（檔案化）");
      console.log(`   - report: ${reportOut}`);
    }

    if (confirmed !== null) {
      startTaskInfo.resultVerified = confirmed;
      console.log(`✅ 已更新 resultVerified: ${String(confirmed)}`);
    }
    startTaskInfo.updatedAt = new Date().toISOString();

    writeFileSync(infoFile, JSON.stringify(startTaskInfo, null, 2), "utf-8");

    console.log(`   - info:   ${infoFile}\n`);
    return;
  }

  // 顯示使用說明
  console.log(`
📝 開發報告更新工具

使用方式：
  node .cursor/scripts/operator/update-development-report.mjs --report="<report-content>"
  node .cursor/scripts/operator/update-development-report.mjs --report-file="<path-to-report-file>"
  node .cursor/scripts/operator/update-development-report.mjs --ticket="FE-1234" --report-file="..."
  node .cursor/scripts/operator/update-development-report.mjs --start-task-dir=".cursor/tmp/FE-1234" --report-file="..."
  node .cursor/scripts/operator/update-development-report.mjs --start-task-info-file=".cursor/tmp/FE-1234/start-task-info.json" --report-file="..."
  node .cursor/scripts/operator/update-development-report.mjs --ticket="FE-1234" --confirmed=true

參數說明：
  --report="..."      直接提供報告內容
  --report-file="..." 從檔案讀取報告內容
  --ticket="..."      指定 ticket（用於推斷 .cursor/tmp/<ticket>/）
  --start-task-dir="..." 指定 start-task 目錄（內含 start-task-info.json）
  --start-task-info-file="..." 指定 start-task-info.json 路徑
`);
}

main();

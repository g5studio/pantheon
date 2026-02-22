#!/usr/bin/env node

/**
 * 保存 start-task info 到 Git notes
 *
 * 此腳本用於在 start-task 流程中，當用戶確認開發計劃後，
 * 將開發計劃信息保存到 Git notes，以便後續建立 MR 時使用。
 *
 * 使用方式：
 *   node .cursor/scripts/operator/save-start-task-info.mjs --ticket=IN-107113 --summary="[標題]" --type=Bug --steps='["步驟1", "步驟2"]'
 *   node .cursor/scripts/operator/save-start-task-info.mjs --json='{"ticket":"IN-107113", ...}'
 *   node .cursor/scripts/operator/save-start-task-info.mjs --read  # 讀取當前的 start-task info
 *   node .cursor/scripts/operator/save-start-task-info.mjs --verify  # 驗證 Git notes 是否存在
 *
 * 參數說明：
 *   --ticket        Jira ticket 編號（必填，除非使用 --json）
 *   --summary       Jira ticket 標題
 *   --type          Issue 類型（Bug, Story, Task, Feature 等）
 *   --status        Jira 狀態
 *   --assignee      負責人
 *   --priority      優先級
 *   --steps         開發步驟（JSON 陣列格式）
 *   --source-branch 來源分支
 *   --ai-completed  是否為 AI 獨立完成（true/false）
 *   --json          完整的 JSON 格式 startTaskInfo（優先使用）
 *   --read          讀取當前的 start-task info
 *   --verify        驗證 Git notes 是否存在
 *   --update        更新現有的 Git notes（合併模式）
 */

import { execSync, spawnSync } from "child_process";
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

// 讀取現有的 start-task info
function readStartTaskInfo() {
  try {
    const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();

    // 嘗試從當前 commit 讀取
    try {
      const noteContent = exec(
        `git notes --ref=start-task show ${currentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return { info: JSON.parse(noteContent), commit: currentCommit };
      }
    } catch (error) {
      // 當前 commit 沒有 Git notes
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
      // 父 commit 沒有 Git notes
    }

    // 嘗試從 base commit 讀取
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

// 保存 start-task info 到 Git notes
function saveStartTaskInfo(startTaskInfo) {
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
      return { success: true, commit: currentCommit };
    }

    return { success: false, error: result.stderr };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 驗證 Git notes 是否存在
function verifyStartTaskInfo() {
  const result = readStartTaskInfo();
  if (result) {
    return {
      exists: true,
      commit: result.commit,
      ticket: result.info.ticket,
      summary: result.info.summary,
    };
  }
  return { exists: false };
}

// 解析命令行參數
function parseArgs(args) {
  const params = {
    read: false,
    verify: false,
    update: false,
    json: null,
    ticket: null,
    summary: null,
    type: null,
    status: null,
    assignee: null,
    priority: null,
    steps: null,
    sourceBranch: null,
    aiCompleted: true, // 預設為 true
  };

  for (const arg of args) {
    if (arg === "--read") {
      params.read = true;
    } else if (arg === "--verify") {
      params.verify = true;
    } else if (arg === "--update") {
      params.update = true;
    } else if (arg.startsWith("--json=")) {
      params.json = arg.slice("--json=".length);
    } else if (arg.startsWith("--ticket=")) {
      params.ticket = arg.slice("--ticket=".length);
    } else if (arg.startsWith("--summary=")) {
      params.summary = arg.slice("--summary=".length);
    } else if (arg.startsWith("--type=")) {
      params.type = arg.slice("--type=".length);
    } else if (arg.startsWith("--status=")) {
      params.status = arg.slice("--status=".length);
    } else if (arg.startsWith("--assignee=")) {
      params.assignee = arg.slice("--assignee=".length);
    } else if (arg.startsWith("--priority=")) {
      params.priority = arg.slice("--priority=".length);
    } else if (arg.startsWith("--steps=")) {
      params.steps = arg.slice("--steps=".length);
    } else if (arg.startsWith("--source-branch=")) {
      params.sourceBranch = arg.slice("--source-branch=".length);
    } else if (arg.startsWith("--ai-completed=")) {
      params.aiCompleted = arg.slice("--ai-completed=".length) === "true";
    }
  }

  return params;
}

// 構建 startTaskInfo 對象
function buildStartTaskInfo(params, existingInfo = null) {
  // 如果提供了完整的 JSON，直接使用
  if (params.json) {
    try {
      const parsed = JSON.parse(params.json);
      // 確保有 startedAt
      if (!parsed.startedAt) {
        parsed.startedAt = new Date().toISOString();
      }
      return parsed;
    } catch (error) {
      console.error(`❌ JSON 解析失敗: ${error.message}`);
      process.exit(1);
    }
  }

  // 基於現有資訊或新建
  const info = existingInfo || {};

  // 更新欄位（只更新有提供的欄位）
  if (params.ticket) info.ticket = params.ticket;
  if (params.summary) info.summary = params.summary;
  if (params.type) info.issueType = params.type;
  if (params.status) info.status = params.status;
  if (params.assignee) info.assignee = params.assignee;
  if (params.priority) info.priority = params.priority;
  if (params.sourceBranch) info.sourceBranch = params.sourceBranch;
  info.aiCompleted = params.aiCompleted;

  // 處理 steps
  if (params.steps) {
    try {
      info.suggestedSteps = JSON.parse(params.steps);
    } catch (error) {
      console.error(`❌ steps 解析失敗: ${error.message}`);
      process.exit(1);
    }
  }

  // 確保有 startedAt
  if (!info.startedAt) {
    info.startedAt = new Date().toISOString();
  }

  // 確保有 featureBranch
  if (!info.featureBranch && info.ticket) {
    info.featureBranch = `feature/${info.ticket}`;
  }

  return info;
}

// 主函數
function main() {
  const args = process.argv.slice(2);
  const params = parseArgs(args);

  // 讀取模式
  if (params.read) {
    const result = readStartTaskInfo();
    if (result) {
      console.log(JSON.stringify(result.info, null, 2));
    } else {
      console.error("❌ 找不到 start-task Git notes");
      process.exit(1);
    }
    return;
  }

  // 驗證模式
  if (params.verify) {
    const result = verifyStartTaskInfo();
    if (result.exists) {
      console.log("✅ Start-task Git notes 存在");
      console.log(`   Commit: ${result.commit}`);
      console.log(`   Ticket: ${result.ticket}`);
      console.log(`   Summary: ${result.summary}`);
    } else {
      console.log("❌ Start-task Git notes 不存在");
      process.exit(1);
    }
    return;
  }

  // 更新模式或新建模式
  let existingInfo = null;
  if (params.update) {
    const existing = readStartTaskInfo();
    if (existing) {
      existingInfo = existing.info;
      console.log("📝 更新模式：將合併現有的 Git notes\n");
    }
  }

  // 檢查必要參數
  if (!params.json && !params.ticket && !existingInfo?.ticket) {
    console.log(`
📝 保存 Start-Task Info 工具

使用方式：
  node .cursor/scripts/operator/save-start-task-info.mjs --ticket=IN-107113 --summary="[標題]" --type=Bug --steps='["步驟1", "步驟2"]'
  node .cursor/scripts/operator/save-start-task-info.mjs --json='{"ticket":"IN-107113", ...}'
  node .cursor/scripts/operator/save-start-task-info.mjs --read
  node .cursor/scripts/operator/save-start-task-info.mjs --verify
  node .cursor/scripts/operator/save-start-task-info.mjs --update --steps='["新步驟"]'

參數說明：
  --ticket        Jira ticket 編號（必填，除非使用 --json 或 --update）
  --summary       Jira ticket 標題
  --type          Issue 類型（Bug, Story, Task, Feature 等）
  --status        Jira 狀態
  --assignee      負責人
  --priority      優先級
  --steps         開發步驟（JSON 陣列格式）
  --source-branch 來源分支
  --ai-completed  是否為 AI 獨立完成（預設 true）
  --json          完整的 JSON 格式 startTaskInfo
  --read          讀取當前的 start-task info
  --verify        驗證 Git notes 是否存在
  --update        更新現有的 Git notes（合併模式）
`);
    process.exit(1);
  }

  // 構建 startTaskInfo
  const startTaskInfo = buildStartTaskInfo(params, existingInfo);

  // 保存到 Git notes
  console.log("💾 正在保存 start-task info 到 Git notes...\n");
  const result = saveStartTaskInfo(startTaskInfo);

  if (result.success) {
    console.log("✅ 已保存 start-task info\n");
    console.log("📋 保存的內容：");
    console.log(JSON.stringify(startTaskInfo, null, 2));
    console.log(`\n📍 Commit: ${result.commit}`);

    // 驗證保存成功
    console.log("\n🔍 驗證保存結果...");
    const verified = verifyStartTaskInfo();
    if (verified.exists) {
      console.log("✅ 驗證成功：Git notes 已正確保存");
    } else {
      console.error("❌ 驗證失敗：無法讀取剛保存的 Git notes");
      process.exit(1);
    }
  } else {
    console.error(`❌ 保存失敗: ${result.error}`);
    process.exit(1);
  }
}

main();

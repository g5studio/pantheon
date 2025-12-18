#!/usr/bin/env node

/**
 * 自動化 Commit 和建立 MR 腳本
 *
 * 功能：
 * 1. 檢查 git 狀態
 * 2. 運行 lint 檢查（可選）
 * 3. 按照 commitlint 規範創建 commit
 * 4. 推送到遠端分支
 * 5. 提供創建 MR 的指令
 */

import { execSync } from "child_process";
import readline from "readline";
import { getProjectRoot } from "../utilities/env-loader.mjs";

// 使用 env-loader 提供的 projectRoot
const projectRoot = getProjectRoot();

// Commit types 定義
const COMMIT_TYPES = {
  feat: "新功能",
  fix: "修復問題",
  update: "更新",
  refactor: "重構",
  chore: "雜務",
  test: "測試",
  style: "樣式",
  revert: "回退",
};

// 顏色輸出
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
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
      log(`錯誤: ${error.message}`, "red");
    }
    throw error;
  }
}

function getGitStatus() {
  try {
    const status = exec("git status --porcelain", { silent: true });
    return status
      .trim()
      .split("\n")
      .filter((line) => line.trim());
  } catch (error) {
    return [];
  }
}

function getCurrentBranch() {
  try {
    return exec("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
  } catch (error) {
    return null;
  }
}

function getRemoteUrl() {
  try {
    const url = exec("git config --get remote.origin.url", {
      silent: true,
    }).trim();
    // 轉換 SSH URL 為 HTTPS URL (GitLab)
    if (url.startsWith("git@")) {
      const match = url.match(/git@([^:]+):(.+)/);
      if (match) {
        const [, host, path] = match;
        return `https://${host}/${path.replace(/\.git$/, "")}`;
      }
    }
    return url.replace(/\.git$/, "");
  } catch (error) {
    return null;
  }
}

function validateTicket(ticket) {
  // Jira ticket 格式: FE-1234, IN-5678 等
  return /^[A-Z0-9]+\-[0-9]+$/.test(ticket);
}

function validateMessage(message) {
  if (!message || message.trim().length === 0) {
    return { valid: false, error: "Commit message 不能為空" };
  }
  if (message.length > 64) {
    return { valid: false, error: "Commit message 不能超過 64 字元" };
  }
  if (message !== message.toLowerCase()) {
    return { valid: false, error: "Commit message 必須是小寫" };
  }
  // 檢查是否包含中文字符
  if (/[\u4e00-\u9fff]/.test(message)) {
    return { valid: false, error: "Commit message 不允許使用中文，請使用英文" };
  }
  return { valid: true };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function main() {
  log("\n🚀 自動化 Commit 和 MR 腳本\n", "cyan");

  // 1. 檢查 git 狀態
  log("📋 檢查 git 狀態...", "blue");
  const changes = getGitStatus();

  if (changes.length === 0) {
    log("❌ 沒有變更需要提交", "yellow");
    rl.close();
    return;
  }

  log(`✅ 發現 ${changes.length} 個變更檔案:`, "green");
  changes.slice(0, 10).forEach((change) => {
    log(`   ${change}`, "reset");
  });
  if (changes.length > 10) {
    log(`   ... 還有 ${changes.length - 10} 個檔案`, "reset");
  }

  // 2. 檢查當前分支
  const currentBranch = getCurrentBranch();
  if (!currentBranch) {
    log("❌ 無法獲取當前分支", "red");
    rl.close();
    return;
  }

  if (
    currentBranch === "main" ||
    currentBranch === "master" ||
    currentBranch === "develop"
  ) {
    log(
      `⚠️  警告: 當前在 ${currentBranch} 分支，建議在 feature 分支上操作`,
      "yellow"
    );
    const confirm = await question("是否繼續? (y/N): ");
    if (confirm.toLowerCase() !== "y") {
      log("已取消", "yellow");
      rl.close();
      return;
    }
  }

  log(`\n📍 當前分支: ${currentBranch}`, "cyan");

  // 3. 詢問是否運行 lint
  const runLint = await question("\n🔍 是否運行 lint 檢查? (Y/n): ");
  if (runLint.toLowerCase() !== "n") {
    log("\n🔍 運行 lint 檢查...", "blue");
    try {
      exec("pnpm run format-and-lint");
      log("✅ Lint 檢查通過", "green");
    } catch (error) {
      log("❌ Lint 檢查失敗，請先修復錯誤", "red");
      rl.close();
      return;
    }
  }

  // 4. 收集 commit 信息
  log("\n📝 請輸入 commit 信息:\n", "cyan");

  // Commit type
  log("可用的 commit types:");
  Object.entries(COMMIT_TYPES).forEach(([type, desc]) => {
    log(`  ${type.padEnd(10)} - ${desc}`, "reset");
  });

  let commitType = "";
  while (!COMMIT_TYPES[commitType]) {
    commitType = await question(
      "\nCommit type (feat/fix/update/refactor/chore/test/style/revert): "
    );
    commitType = commitType.trim().toLowerCase();
    if (!COMMIT_TYPES[commitType]) {
      log("❌ 無效的 commit type，請重新輸入", "red");
    }
  }

  // Jira ticket
  let ticket = "";
  while (!validateTicket(ticket)) {
    ticket = await question("Jira ticket (格式: FE-1234): ");
    ticket = ticket.trim().toUpperCase();
    if (!validateTicket(ticket)) {
      log("❌ Ticket 格式錯誤，應為: FE-1234, IN-5678 等", "red");
    }
  }

  // Commit message
  let message = "";
  let messageValid = false;
  while (!messageValid) {
    message = await question("Commit message (小寫，最大 64 字元): ");
    message = message.trim();
    const validation = validateMessage(message);
    if (!validation.valid) {
      log(`❌ ${validation.error}`, "red");
    } else {
      messageValid = true;
    }
  }

  // 5. 構建 commit message
  const commitMessage = `${commitType}(${ticket}): ${message}`;
  log(`\n📝 Commit message: ${commitMessage}`, "cyan");

  // 6. 確認
  const confirm = await question("\n是否繼續提交? (Y/n): ");
  if (confirm.toLowerCase() === "n") {
    log("已取消", "yellow");
    rl.close();
    return;
  }

  // 7. 添加檔案
  log("\n📦 添加檔案到暫存區...", "blue");
  try {
    exec("git add .");
    log("✅ 檔案已添加", "green");
  } catch (error) {
    log("❌ 添加檔案失敗", "red");
    rl.close();
    return;
  }

  // 8. 創建 commit
  log("\n💾 創建 commit...", "blue");
  try {
    exec(`git commit -m "${commitMessage}"`);
    log("✅ Commit 創建成功", "green");
  } catch (error) {
    log("❌ Commit 創建失敗", "red");
    rl.close();
    return;
  }

  // 9. 推送到遠端
  log("\n🚀 推送到遠端...", "blue");
  const pushConfirm = await question("是否推送到遠端? (Y/n): ");
  if (pushConfirm.toLowerCase() !== "n") {
    try {
      exec(`git push origin ${currentBranch}`);
      log("✅ 推送成功", "green");
    } catch (error) {
      log("❌ 推送失敗", "red");
      log(
        "提示: 如果分支不存在，請使用: git push -u origin " + currentBranch,
        "yellow"
      );
      rl.close();
      return;
    }
  }

  // 10. 提供 MR 連結
  const remoteUrl = getRemoteUrl();
  if (remoteUrl) {
    log("\n🔗 建立 Merge Request:", "cyan");
    log(
      `   ${remoteUrl}/-/merge_requests/new?merge_request[source_branch]=${currentBranch}`,
      "green"
    );
    log("\n或者使用以下指令:", "cyan");
    log(
      `   gh mr create --title "${commitMessage}" --body "相關 Jira ticket: ${ticket}"`,
      "reset"
    );
  }

  log("\n✅ 完成！", "green");
  rl.close();
}

main().catch((error) => {
  log(`\n❌ 發生錯誤: ${error.message}`, "red");
  rl.close();
  process.exit(1);
});

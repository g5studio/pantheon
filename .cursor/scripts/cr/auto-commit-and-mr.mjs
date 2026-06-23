#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/cr/auto-commit-and-mr.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8065
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-8065
 */
/**
 * @module auto-commit-and-mr
 * @purpose 自動化 Commit 與建立 MR 的指令腳本
 * @external https://innotech.atlassian.net/browse/FE-7893
 *
 * 功能:
 * 1. 檢查 git 狀態
 * 2. 運行 lint 檢查（可選）
 * 3. 依照 commitlint 規範生成提交訊息、推送並提供 MR 連結/指令
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import readline from "readline";
import { getProjectRoot } from "../utilities/env-loader.mjs";

/**
 * @description 解析並緩存專案根目錄
 * @purpose 專供後續 git/檔案讀取以定位專案工作目錄
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
const projectRoot = getProjectRoot();

/**
 * @description Commit 類型對照表（用於指引互動與生成提交訊息）
 * @purpose 用於互動式選單與提交訊息組裝中的 commit type 判斷
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
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

/**
 * @description 終端顏色樣式對照
 * @purpose 支援 log 的字串配色顯示
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

/**
 * @description 以指定顏色輸出訊息到主控台
 * @purpose 將訊息依據互動流程輸出成不同語意色彩
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} message 要輸出的訊息
 * @param {"reset"|"bright"|"red"|"green"|"yellow"|"blue"|"cyan"} [color="reset"] 顏色鍵
 */
function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * @description 在專案根目錄下執行系統命令
 * @purpose 統一以 projectRoot 作為執行工作目錄，並在失敗時回報錯誤
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} command 指令字串
 * @param {{silent?: boolean}} [options] 選項；silent 時隱藏標準輸出
 * @returns {string|Buffer} 命令輸出
 * @throws {Error} 當命令執行失敗時拋出
 */
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

/**
 * @description 檢查 package.json 是否定義指定的 npm script
 * @purpose 判斷專案是否具備特定 lint/format script 可供執行
 * @external https://innotech.atlassian.net/browse/FE-8065
 * @param {string} scriptName 腳本名稱
 * @returns {boolean} 是否存在
 */
function hasPackageScript(scriptName) {
  try {
    const packageJsonPath = join(projectRoot, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return Boolean(packageJson.scripts?.[scriptName]);
  } catch (error) {
    return false;
  }
}

/**
 * @description 取得工作區變更清單（porcelain 格式）
 * @purpose 用於判斷是否有需要提交的檔案變更
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @returns {string[]} 變更行陣列
 */
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

/**
 * @description 取得目前 Git 分支名稱
 * @purpose 於互動流程中取得分支資訊以進行提交/推送
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @returns {string|null} 分支名稱；失敗時為 null
 */
function getCurrentBranch() {
  try {
    return exec("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
  } catch (error) {
    return null;
  }
}

/**
 * @description 取得遠端 origin URL，並將 SSH 形式轉為 HTTPS（去除 .git）
 * @purpose 用於輸出建立 Merge Request 所需的遠端連結
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @returns {string|null} 遠端 URL；失敗時為 null
 */
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

/**
 * @description 檢驗 Jira ticket 格式（如 FE-1234）
 * @purpose 驗證輸入的 Jira ticket 字串是否符合預期格式
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} ticket 輸入字串
 * @returns {boolean} 是否符合格式
 */
function validateTicket(ticket) {
  // Jira ticket 格式: FE-1234, IN-5678 等
  return /^[A-Z0-9]+\-[0-9]+$/.test(ticket);
}

/**
 * @description 驗證提交訊息是否符合規範
 * @purpose 確保提交訊息在字元長度/大小寫/中文等規則上符合預期
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} message 提交訊息
 * @returns {{valid: boolean, error?: string}} 驗證結果
 */
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

/**
 * @description Node.js 讀寫介面，用於命令列互動
 * @purpose 提供 question() 以支援互動式輸入
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * @description 將 readline.question 包裝為 Promise API
 * @purpose 將命令列提問改為可 await 的非同步輸入
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @param {string} query 提示字串
 * @returns {Promise<string>} 使用者輸入
 */
function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

/**
 * @description 主要流程：檢查變更、可選 lint、收集提交資訊、提交並推送、輸出 MR 連結
 * @purpose 協調整體互動式自動化 commit 與 MR 建立輸出
 * @external https://innotech.atlassian.net/browse/FE-7893
 * @returns {Promise<void>}
 */
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
    if (!hasPackageScript("format-and-lint")) {
      log("\n⚠️  查無 format-and-lint script，略過 lint 檢查", "yellow");
    } else {
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

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactoring-engine
 * @llm-review-note 已依需求將檔案/宣告註解改為三區塊與統一 @module/@purpose/@description 等格式，並根據 declarationOrigins 補上對應外部單號（無對應 tickets 的 declaration 省略 @external）。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:15:42.232Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 將宣告/函式等 JSDoc 的 @external 改為完整 Jira browse URL、補齊 declarationOrigins 對應 ticket 與省略無對應 ticket 的 @external；並維持程式邏輯不變。
 */

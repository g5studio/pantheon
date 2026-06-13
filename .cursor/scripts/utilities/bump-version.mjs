#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/bump-version.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * 檔案用途區塊
 * @module .cursor/scripts/utilities/bump-version.mjs
 * @purpose 版本跳板工具：在指定檔案中讀取目前版本、依跳板類型計算新版本、寫回並執行 Git 提交與推送。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */

/**
 * 版本跳板工具腳本
 *
 * 說明：
 * - 在指定檔案中尋找並讀寫版本號
 * - 依選擇的跳板類型計算新版本
 * - 寫回檔案並以 Git 送出、推送
 *
 * 使用方式：
 *   node bump-version.mjs --files="package.json,build.properties" --type=same-env [--yes]
 *
 * 參數：
 *   --files     要處理的檔案路徑，多個檔案用逗號分隔
 *   --type      跳板類型：same-env（同環境進版）或 upgrade（環境升級）
 *   --yes, -y   自動確認，不詢問
 *
 * 支援的檔案格式：
 *   - package.json: 讀取/更新 "version" 欄位
 *   - build.properties: 讀取/更新 config.brands.*.ver 配置
 *   - *.json (其他): 讀取/更新 "version" 或第一個 string 欄位
 */

import { execSync } from "child_process";
import { join, basename } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import readline from "readline";
import { getProjectRoot } from "./env-loader.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 專案根目錄絕對路徑，供後續組合檔案路徑時使用。
 * @purpose 用於讓此腳本在不同執行位置下仍能穩定讀寫目標檔案。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
const projectRoot = getProjectRoot();

// ============================================
// 工具函數
// ============================================

/**
 * 在專案根目錄下執行 shell 指令。
 * @param {string} command - 要執行的指令。
 * @param {{ silent?: boolean } & import('child_process').ExecSyncOptions} [options={}] - 選項；silent 為 true 時不將輸出寫到標準輸出。
 * @returns {string} 指令輸出（silent 模式下為字串，否則通常為空字串）。
 * @throws {Error} 執行失敗時拋出錯誤。
 * @external https://innotech.atlassian.net/browse/FE-7893
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
      console.error(`錯誤: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// 版本解析與格式化
// ============================================

/**
 * 將版本字串解析為物件。
 * 支援格式：
 * - major.minor.patch (如 5.36.0)
 * - major.minor.patch-suffix (如 5.36.0-b, 5.36.0-z.a)
 * - major.minor.patch-beta.N (如 0.0.0-beta.3)
 * @param {string} version - 要解析的版本字串。
 * @returns {{major:number, minor:number, patch:number, suffix:string|null, beta:number|null}}
 * @throws {Error} 當版本字串無法解析時拋出。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function parseVersion(version) {
  // 匹配 beta 格式
  const betaMatch = version.match(/^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/);
  if (betaMatch) {
    return {
      major: parseInt(betaMatch[1], 10),
      minor: parseInt(betaMatch[2], 10),
      patch: parseInt(betaMatch[3], 10),
      suffix: null,
      beta: parseInt(betaMatch[4], 10),
    };
  }

  // 匹配標準格式和 stg suffix 格式
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+(?:\.[a-z]+)*))?$/
  );
  if (!match) {
    throw new Error(`無法解析版本號: ${version}`);
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    suffix: match[4] || null,
    beta: null,
  };
}

/**
 * 將版本物件格式化為字串。
 * @param {{major:number, minor:number, patch:number, suffix:string|null, beta:number|null}} versionObj - 版本物件。
 * @returns {string} 版本字串。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function formatVersion(versionObj) {
  let version = `${versionObj.major}.${versionObj.minor}.${versionObj.patch}`;
  if (versionObj.beta !== null) {
    version += `-beta.${versionObj.beta}`;
  } else if (versionObj.suffix) {
    version += `-${versionObj.suffix}`;
  }
  return version;
}

/**
 * 推進英文字母序列。
 * 規則：a -> b，z -> z.a，z.a -> z.b。
 * @param {string} letter - 當前字尾字母序列。
 * @returns {string} 推進後的字尾字母序列。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function incrementLetter(letter) {
  if (!letter || letter.length === 0) {
    return "a";
  }
  const lastChar = letter[letter.length - 1];
  if (lastChar === "z") {
    return letter + ".a";
  }
  const newChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);
  return letter.slice(0, -1) + newChar;
}

/**
 * 同環境進版。
 * - 若為 beta 版本：beta 數字 +1
 * - 若帶 suffix：推進英文字母
 * - 其他情況：patch +1
 * @param {string} currentVersion - 當前版本字串。
 * @returns {string} 新版本字串。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function bumpSameEnvironment(currentVersion) {
  const version = parseVersion(currentVersion);

  // beta 版本：推進 beta 數字
  if (version.beta !== null) {
    version.beta += 1;
    return formatVersion(version);
  }

  // stg 版本：推進英文字母
  if (version.suffix) {
    version.suffix = incrementLetter(version.suffix);
    return formatVersion(version);
  }

  // 一般版本：推進 patch 版本
  version.patch += 1;
  return formatVersion(version);
}

/**
 * 環境升級（移除 suffix/beta 標記）。
 * @param {string} currentVersion - 當前版本字串。
 * @returns {string} 新版本字串（去除 beta/suffix）。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function bumpEnvironmentUpgrade(currentVersion) {
  const version = parseVersion(currentVersion);
  version.suffix = null;
  version.beta = null;
  return formatVersion(version);
}

// ============================================
// 檔案處理器
// ============================================

/**
 * 從 package.json 讀取版本。
 * @param {string} filePath - 相對於專案根目錄的檔案路徑。
 * @returns {string} 版本字串。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function readVersionFromPackageJson(filePath) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content);
  return data.version;
}

/**
 * 更新 package.json 版本。
 * @param {string} filePath - 相對於專案根目錄的檔案路徑。
 * @param {string} newVersion - 要寫入的新版本字串。
 * @returns {void}
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function updatePackageJsonVersion(filePath, newVersion) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content);
  data.version = newVersion;
  writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * 從 build.properties 讀取版本。
 * 會回傳第一個符合 config.brands.*.ver 的版本字串。
 * @param {string} filePath - 相對於專案根目錄的檔案路徑。
 * @returns {string} 版本字串。
 * @throws {Error} 若未能取得版本字串則拋出。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function readVersionFromBuildProperties(filePath) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^config\.brands\.\w+\.ver=(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }

  throw new Error(`無法從 ${filePath} 讀取版本號`);
}

/**
 * 更新 build.properties 版本。
 * 僅更新前 32 行中的 config.brands.*.ver。
 * @param {string} filePath - 相對於專案根目錄的檔案路徑。
 * @param {string} newVersion - 要寫入的新版本字串。
 * @returns {void}
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function updateBuildPropertiesVersion(filePath, newVersion) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  // 更新前 32 行的版本號
  for (let i = 0; i < lines.length && i < 32; i++) {
    const match = lines[i].match(/^config\.brands\.(\w+)\.ver=(.+)$/);
    if (match) {
      lines[i] = `config.brands.${match[1]}.ver=${newVersion}`;
    }
  }

  writeFileSync(fullPath, lines.join("\n"), "utf-8");
}

/**
 * 從一般 JSON 檔案讀取版本。
 * 優先順序：version -> pantheon -> 第一個字串欄位。
 * @param {string} filePath - 相對於專案根目錄的檔案路徑。
 * @returns {string} 版本字串。
 * @throws {Error} 若未能取得版本字串則拋出。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function readVersionFromJson(filePath) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content);

  // 優先嘗試常見的版本欄位名稱
  if (data.version) return data.version;
  if (data.pantheon) return data.pantheon;

  // 取第一個 string 類型的值
  for (const key of Object.keys(data)) {
    if (typeof data[key] === "string") {
      return data[key];
    }
  }

  throw new Error(`無法從 ${filePath} 讀取版本號`);
}

/**
 * 更新一般 JSON 檔案版本。
 * 優先順序：version -> pantheon -> 第一個字串欄位。
 * @param {string} filePath - 相對於專案根目錄的檔案路徑。
 * @param {string} newVersion - 要寫入的新版本字串。
 * @returns {void}
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function updateJsonVersion(filePath, newVersion) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content);

  // 優先更新常見的版本欄位名稱
  if (data.version !== undefined) {
    data.version = newVersion;
  } else if (data.pantheon !== undefined) {
    data.pantheon = newVersion;
  } else {
    // 更新第一個 string 類型的欄位
    for (const key of Object.keys(data)) {
      if (typeof data[key] === "string") {
        data[key] = newVersion;
        break;
      }
    }
  }

  writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * 根據檔案類型讀取版本。
 * 支援：package.json、build.properties、*.json。
 * @param {string} filePath - 檔案路徑（相對於專案根目錄）。
 * @returns {string} 版本字串。
 * @throws {Error} 不支援的檔案格式時拋出。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function readVersionFromFile(filePath) {
  const fileName = basename(filePath);

  if (fileName === "package.json") {
    return readVersionFromPackageJson(filePath);
  } else if (fileName === "build.properties") {
    return readVersionFromBuildProperties(filePath);
  } else if (filePath.endsWith(".json")) {
    return readVersionFromJson(filePath);
  }

  throw new Error(`不支援的檔案格式: ${filePath}`);
}

/**
 * 根據檔案類型更新版本。
 * 成功後在終端輸出更新結果。
 * @param {string} filePath - 檔案路徑（相對於專案根目錄）。
 * @param {string} newVersion - 新版本字串。
 * @returns {void}
 * @throws {Error} 不支援的檔案格式時拋出。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function updateVersionInFile(filePath, newVersion) {
  const fileName = basename(filePath);

  if (fileName === "package.json") {
    updatePackageJsonVersion(filePath, newVersion);
  } else if (fileName === "build.properties") {
    updateBuildPropertiesVersion(filePath, newVersion);
  } else if (filePath.endsWith(".json")) {
    updateJsonVersion(filePath, newVersion);
  } else {
    throw new Error(`不支援的檔案格式: ${filePath}`);
  }

  console.log(`✅ 已更新 ${filePath} 版本: ${newVersion}`);
}

// ============================================
// 命令行解析
// ============================================

/**
 * 解析 CLI 參數。
 * 支援：
 * - --files
 * - --type（same-env/upgrade 或 1/2 別名）
 * - --yes / --confirm / -y
 * @returns {{files: string[], type: ('same-environment'|'environment-upgrade'|null), confirm: boolean}}
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    files: [],
    type: null,
    confirm: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--files=")) {
      const filesStr = arg.slice("--files=".length);
      options.files = filesStr.split(",").map((f) => f.trim());
    } else if (
      arg === "--same-env" ||
      arg === "--type=same-env" ||
      arg === "--type=1" ||
      arg === "1"
    ) {
      options.type = "same-environment";
    } else if (
      arg === "--upgrade" ||
      arg === "--type=upgrade" ||
      arg === "--type=2" ||
      arg === "2"
    ) {
      options.type = "environment-upgrade";
    } else if (arg === "--yes" || arg === "--confirm" || arg === "-y") {
      options.confirm = true;
    }
  }

  return options;
}

/**
 * 與使用者互動以選擇版本更新種類。
 * @returns {Promise<'same-environment'|'environment-upgrade'>} 使用者選擇的更新種類。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function askUserForBumpType() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n📋 請選擇版本更新種類：\n");
    console.log("1. 同環境進版");
    console.log("   - stg 版本推進英文字母（5.36.0-b -> 5.36.0-c）");
    console.log("   - beta 版本推進數字（0.0.0-beta.3 -> 0.0.0-beta.4）");
    console.log("   - 一般版本推進 patch（5.36.0 -> 5.36.1）\n");
    console.log("2. 環境升級（stg -> uat / beta -> release）");
    console.log("   - 移除環境特徵編號（5.36.0-z -> 5.36.0）\n");

    rl.question("請輸入選項 (1 或 2): ", (answer) => {
      rl.close();
      const choice = answer.trim();
      if (choice === "1") {
        resolve("same-environment");
      } else if (choice === "2") {
        resolve("environment-upgrade");
      } else {
        console.error("\n❌ 無效的選項，請輸入 1 或 2\n");
        process.exit(1);
      }
    });
  });
}

/**
 * 詢問使用者確認動作。
 * @param {string} message - 顯示給使用者的訊息。
 * @returns {Promise<boolean>} 使用者是否確認。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function askUserForConfirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ============================================
// Git 操作
// ============================================

/**
 * 取得目前 Git 分支名稱。
 * @returns {string} 分支名稱。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function getCurrentBranch() {
  return exec("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
}

/**
 * 檢查當前工作區是否有未提交變更。
 * @returns {boolean} 有未提交變更時回傳 true。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function hasUncommittedChanges() {
  try {
    const status = exec("git status --porcelain", { silent: true });
    return status.trim().length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * 提交並推送版本更新至遠端。
 * 若分支包含 Jira ticket（FE/IN-數字），則以符合 commitlint 的格式提交；否則跳過驗證。
 * @param {string[]} files - 要提交的檔案清單。
 * @param {string} currentVersion - 目前版本字串。
 * @param {string} newVersion - 新版本字串。
 * @returns {void}
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function commitAndPush(files, currentVersion, newVersion) {
  const currentBranch = getCurrentBranch();
  const ticketMatch = currentBranch.match(/(FE|IN)-\d+/);

  let commitMessage;
  if (ticketMatch) {
    commitMessage = `chore(${ticketMatch[0]}): bump version ${currentVersion} -> ${newVersion}`;
  } else {
    console.log("⚠️  當前分支沒有 Jira ticket，將跳過 commitlint 檢查\n");
    commitMessage = `chore: bump version ${currentVersion} -> ${newVersion}`;
  }

  console.log("\n📝 正在提交變更...\n");
  exec(`git add ${files.join(" ")}`);

  if (ticketMatch) {
    exec(`git commit -m "${commitMessage}"`);
  } else {
    exec(`git commit --no-verify -m "${commitMessage}"`);
  }

  console.log("\n🚀 正在推送到遠端...\n");
  exec(`git push origin ${currentBranch}`);

  console.log("\n✅ 版本更新完成！\n");
  console.log(`📦 新版本: ${newVersion}`);
  console.log(`🌿 分支: ${currentBranch}`);
  console.log(`📄 更新檔案: ${files.join(", ")}\n`);
}

// ============================================
// 主程式
// ============================================

/**
 * 入口流程：解析參數、驗證狀態、計算並更新版本、最後提交推送。
 * @returns {Promise<void>}
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
async function main() {
  console.log("🚀 版本跳板工具\n");

  const options = parseArgs();

  // 驗證參數
  if (options.files.length === 0) {
    console.error("❌ 必須提供 --files 參數指定要處理的檔案\n");
    console.error("使用方式：");
    console.error(
      '  node bump-version.mjs --files="package.json" --type=same-env\n'
    );
    process.exit(1);
  }

  // 驗證檔案存在
  const validFiles = [];
  for (const file of options.files) {
    const fullPath = join(projectRoot, file);
    if (!existsSync(fullPath)) {
      console.error(`❌ 檔案不存在: ${file}`);
      process.exit(1);
    }
    validFiles.push(file);
  }

  console.log(`📄 處理檔案: ${validFiles.join(", ")}\n`);

  // 檢查未提交變更
  if (hasUncommittedChanges()) {
    console.error("❌ 檢測到未提交的變更！\n");
    console.error("💡 請先提交或暫存變更後再執行版本更新\n");
    process.exit(1);
  }

  // 讀取當前版本（從第一個檔案）
  const currentVersion = readVersionFromFile(validFiles[0]);
  console.log(`📦 當前版本: ${currentVersion}\n`);

  // 獲取跳板類型
  let bumpType = options.type;
  if (!bumpType) {
    bumpType = await askUserForBumpType();
  } else {
    console.log(
      `📋 跳板類型: ${
        bumpType === "same-environment" ? "同環境進版" : "環境升級"
      }\n`
    );
  }

  // 計算新版本
  let newVersion;
  if (bumpType === "same-environment") {
    newVersion = bumpSameEnvironment(currentVersion);
    console.log(`\n🔄 同環境進版: ${currentVersion} -> ${newVersion}\n`);
  } else {
    newVersion = bumpEnvironmentUpgrade(currentVersion);
    console.log(`\n⬆️  環境升級: ${currentVersion} -> ${newVersion}\n`);
  }

  // 確認更新
  if (!options.confirm) {
    const confirmed = await askUserForConfirm(
      `❓ 確認要將版本從 ${currentVersion} 更新為 ${newVersion} 嗎？`
    );
    if (!confirmed) {
      console.log("\n❌ 已取消版本更新\n");
      process.exit(0);
    }
  }

  // 更新所有檔案
  for (const file of validFiles) {
    updateVersionInFile(file, newVersion);
  }

  // 提交並推送
  commitAndPush(validFiles, currentVersion, newVersion);
}

main().catch((error) => {
  console.error(`\n❌ 發生錯誤: ${error.message}\n`);
  process.exit(1);
});

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactor-engine
 * @llm-review-note 更新檔案層級與宣告區塊之註解格式：補齊三段式區塊標題/標籤；宣告註解依輸入 tickets 指定使用 @external；不變更程式邏輯。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:29:12.582Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 把所有 @external 票號改為完整 Jira browse URL；並保留三段式註解區塊結構與現有宣告用途標示，不改動程式邏輯。
 */

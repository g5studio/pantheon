#!/usr/bin/env node

/**
 * 版本跳板工具腳本
 *
 * 這是一個純粹的版本號處理工具，只負責：
 * 1. 在指定檔案中找到版本號位置
 * 2. 根據跳板類型計算新版本號
 * 3. 更新檔案中的版本號
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

// 使用 env-loader 提供的 projectRoot
const projectRoot = getProjectRoot();

// ============================================
// 工具函數
// ============================================

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
 * 解析版本號
 * 支援格式：
 * - major.minor.patch (如 5.36.0)
 * - major.minor.patch-suffix (如 5.36.0-b, 5.36.0-z.a)
 * - major.minor.patch-beta.N (如 0.0.0-beta.3)
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
 * 格式化版本號
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
 * 推進英文字母
 * a -> b, z -> z.a, z.a -> z.b
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
 * 同環境進版
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
 * 環境升級（移除 suffix/beta）
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
 * 從 package.json 讀取版本
 */
function readVersionFromPackageJson(filePath) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content);
  return data.version;
}

/**
 * 更新 package.json 版本
 */
function updatePackageJsonVersion(filePath, newVersion) {
  const fullPath = join(projectRoot, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const data = JSON.parse(content);
  data.version = newVersion;
  writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * 從 build.properties 讀取版本
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
 * 更新 build.properties 版本
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
 * 從一般 JSON 檔案讀取版本
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
 * 更新一般 JSON 檔案版本
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
 * 根據檔案類型讀取版本
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
 * 根據檔案類型更新版本
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

function getCurrentBranch() {
  return exec("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
}

function hasUncommittedChanges() {
  try {
    const status = exec("git status --porcelain", { silent: true });
    return status.trim().length > 0;
  } catch (error) {
    return false;
  }
}

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

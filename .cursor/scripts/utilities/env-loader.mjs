#!/usr/bin/env node

/**
 * 環境變數載入器
 *
 * 用於統一管理所有腳本的環境變數載入邏輯。
 * 使用 process.cwd() 作為專案根目錄，確保無論腳本位於哪裡
 * （直接在 .cursor/scripts/ 或 .pantheon/.cursor/scripts/），
 * 都能正確找到配置文件。
 *
 * 使用方式:
 *   import { loadEnvLocal, getJiraConfig, getGitLabToken } from './utilities/env-loader.mjs';
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * 獲取專案根目錄
 * 使用 process.cwd() 而非基於腳本位置計算，
 * 確保在 submodule 環境下也能正確找到配置文件。
 */
export function getProjectRoot() {
  return process.cwd();
}

/**
 * 解析 .env 文件內容
 *
 * @param {string} content - .env 文件內容
 * @returns {Object} 環境變數鍵值對
 */
function parseEnvContent(content) {
  const env = {};
  content.split("\n").forEach((line) => {
    line = line.trim();
    if (line && !line.startsWith("#")) {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts
          .join("=")
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  });
  return env;
}

/**
 * 讀取 .env.local 文件
 * 優先級：.cursor/.env.local > 項目根目錄/.env.local
 *
 * 當 .cursor/.env.local 中缺少某個配置時，會從項目根目錄的 .env.local 中讀取作為備援。
 * 這樣可以確保在 submodule 環境下，如果 .cursor/.env.local 沒有設置某個配置，
 * 但主專案的 .env.local 有設置，也可以使用。
 *
 * @returns {Object} 環境變數鍵值對（合併後的結果）
 */
export function loadEnvLocal() {
  const projectRoot = getProjectRoot();
  let mergedEnv = {};

  // 優先級 2（備援）: 項目根目錄的 .env.local
  const projectEnvPath = join(projectRoot, ".env.local");
  if (existsSync(projectEnvPath)) {
    const projectEnvContent = readFileSync(projectEnvPath, "utf-8");
    mergedEnv = { ...mergedEnv, ...parseEnvContent(projectEnvContent) };
  }

  // 優先級 1（最高）: .cursor/.env.local
  const cursorEnvPath = join(projectRoot, ".cursor", ".env.local");
  if (existsSync(cursorEnvPath)) {
    const cursorEnvContent = readFileSync(cursorEnvPath, "utf-8");
    mergedEnv = { ...mergedEnv, ...parseEnvContent(cursorEnvContent) };
  }

  return mergedEnv;
}

/**
 * 引導用戶設置 Jira 配置
 */
export function guideJiraConfig() {
  console.error("\n❌ Jira 配置缺失！\n");
  console.error("📝 請按照以下步驟設置 Jira 配置：\n");

  console.error("**1. 設置 Jira Email:**");
  console.error("   在 .env.local 文件中添加:");
  console.error("   JIRA_EMAIL=your-email@example.com");
  console.error("   或設置環境變數:");
  console.error("   export JIRA_EMAIL=your-email@example.com");
  console.error("");

  console.error("**2. 設置 Jira API Token:**");
  console.error(
    "   1. 前往: https://id.atlassian.com/manage-profile/security/api-tokens"
  );
  console.error('   2. 點擊 "Create API token"');
  console.error('   3. 填寫 Label（例如: "fluid-project"）');
  console.error('   4. 點擊 "Create"');
  console.error("   5. 複製生成的 token（只會顯示一次）");
  console.error("   6. 在 .env.local 文件中添加:");
  console.error("      JIRA_API_TOKEN=your-api-token");
  console.error("   或設置環境變數:");
  console.error("      export JIRA_API_TOKEN=your-api-token");
  console.error("");

  console.error("💡 提示：");
  console.error("   - .env.local 文件可位於項目根目錄或 .cursor 目錄");
  console.error(
    "   - 如果沒有 .env.local 文件，可以參考 .env.development 範本"
  );
  console.error("   - 設置完成後，請重新執行命令\n");
}

/**
 * 獲取 Jira 配置（從環境變數或 .env.local 讀取）
 *
 * @param {boolean} throwOnMissing - 缺失時是否拋出錯誤（預設 true）
 * @returns {Object} Jira 配置 { email, apiToken, baseUrl }
 */
export function getJiraConfig(throwOnMissing = true) {
  // 優先從環境變數讀取
  const envLocal = loadEnvLocal();
  const email = process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN || envLocal.JIRA_API_TOKEN;
  // Base URL 固定為 innotech
  const baseUrl = "https://innotech.atlassian.net/";

  if (!email || !apiToken) {
    if (throwOnMissing) {
      guideJiraConfig();
      throw new Error("Jira 配置缺失，請檢查 .env.local 文件");
    }
    return null;
  }

  return {
    email,
    apiToken,
    baseUrl,
  };
}

/**
 * 從環境變數、.env.local 或 git config 獲取 GitLab token
 *
 * @returns {string|null} GitLab token 或 null
 */
export function getGitLabToken() {
  // 優先級 1: 從環境變數獲取
  if (process.env.GITLAB_TOKEN) {
    return process.env.GITLAB_TOKEN;
  }

  // 優先級 2: 從 .env.local 讀取
  const envLocal = loadEnvLocal();
  if (envLocal.GITLAB_TOKEN) {
    return envLocal.GITLAB_TOKEN;
  }

  // 優先級 3: 嘗試從 git config 獲取
  try {
    const token = execSync("git config --get gitlab.token", {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (token) return token;
  } catch (error) {
    // 忽略錯誤
  }

  return null;
}

/**
 * 獲取 Jira email（從環境變數或 .env.local）
 *
 * @returns {string|null} Jira email 或 null
 */
export function getJiraEmail() {
  const envLocal = loadEnvLocal();
  return process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL || null;
}

/**
 * 獲取 Compass API token（從環境變數或 .env.local）
 *
 * @returns {string|null} Compass API token 或 null
 */
export function getCompassApiToken() {
  const envLocal = loadEnvLocal();
  return process.env.COMPASS_API_TOKEN || envLocal.COMPASS_API_TOKEN || null;
}

/**
 * 獲取 MR Reviewer（從環境變數或 .env.local）
 *
 * @returns {string|null} MR Reviewer 或 null
 */
export function getMRReviewer() {
  const envLocal = loadEnvLocal();
  return process.env.MR_REVIEWER || envLocal.MR_REVIEWER || null;
}

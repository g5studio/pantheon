#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/env-loader.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-7840
 * @external https://innotech.atlassian.net/browse/FE-8004
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * 檔案用途區塊
 * @module env-loader
 * @purpose 統一管理各腳本所需之環境變數載入與既有設定讀取。
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7840
 * @external https://innotech.atlassian.net/browse/FE-8004
 */

import { readFileSync, existsSync } from "fs";
import { join, sep } from "path";
import { execSync } from "child_process";

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得專案根目錄；以 process.cwd() 為基準並處理 Pantheon submodule 情境下的路徑校正。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
export function getProjectRoot() {
  const cwd = process.cwd();

  /**
   * 根治常見誤用：
   * - 當 Pantheon 以 submodule 掛載在主專案的 `.pantheon/` 時
   * - 使用者/agent 可能會 `cd .pantheon` 後直接執行腳本
   *
   * 若仍以 cwd 當作專案根目錄，會導致：
   * - 讀不到主專案根目錄的 `.env.local` 或 `.cursor/.env.local`
   * - 進而誤判為「Jira 配置缺失」
   *
   * 因此：若 cwd 位於 `.pantheon` 內，將根目錄校正為主專案根目錄。
   */
  const pantheonSegment = `${sep}.pantheon${sep}`;
  if (cwd.includes(pantheonSegment)) {
    return cwd.split(pantheonSegment)[0];
  }

  const pantheonDirSuffix = `${sep}.pantheon`;
  if (cwd.endsWith(pantheonDirSuffix)) {
    return cwd.slice(0, -pantheonDirSuffix.length) || cwd;
  }

  return cwd;
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
 * === 宣告內容用途說明與單號關聯 ===
 * @description 讀取並合併 .env.local（優先 .cursor/.env.local，其次項目根目錄 .env.local），以欄位為粒度僅在主要值非空時覆蓋備援值。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
export function loadEnvLocal() {
  const projectRoot = getProjectRoot();

  // 讀取優先級 2（備援）: 項目根目錄的 .env.local
  let fallbackEnv = {};
  const projectEnvPath = join(projectRoot, ".env.local");
  if (existsSync(projectEnvPath)) {
    const projectEnvContent = readFileSync(projectEnvPath, "utf-8");
    fallbackEnv = parseEnvContent(projectEnvContent);
  }

  // 讀取優先級 1（最高）: .cursor/.env.local
  let primaryEnv = {};
  const cursorEnvPath = join(projectRoot, ".cursor", ".env.local");
  if (existsSync(cursorEnvPath)) {
    const cursorEnvContent = readFileSync(cursorEnvPath, "utf-8");
    primaryEnv = parseEnvContent(cursorEnvContent);
  }

  // 合併邏輯：以備援為基底，僅用有效的主要配置覆蓋
  const mergedEnv = { ...fallbackEnv };

  for (const [key, value] of Object.entries(primaryEnv)) {
    // 只有當值非空時才覆蓋備援值
    if (value !== "" && value !== undefined && value !== null) {
      mergedEnv[key] = value;
    }
  }

  return mergedEnv;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 當 Jira 需要的設定缺失時，透過終端提供使用者設定步驟提示。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
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
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Jira 設定（email/apiToken 由環境變數或 loadEnvLocal 讀取；baseUrl 固定為 innotech）。缺失時可選擇丟出錯誤或回傳 null。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
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
 * === 宣告內容用途說明與單號關聯 ===
 * @description 從環境變數、.env.local 或 git config 依序取得 GitLab token。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
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
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Jira email（由環境變數或 loadEnvLocal 讀取）。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
export function getJiraEmail() {
  const envLocal = loadEnvLocal();
  return process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL || null;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 移除 base URL 尾端斜線。
 * @purpose 供 Reviewer / Communicator API base URL 正規化。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function normalizeEnvBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 從候選字串中取得第一個非空值。
 * @purpose env 讀取與 legacy fallback 共用。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function pickFirstEnvString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export const DEFAULT_REVIEWER_AGENT_API_URL =
  "https://mac09demac-mini.balinese-python.ts.net";

export const DEFAULT_COMMUNICATOR_AGENT_API_URL =
  "https://manageds-virtual-machine.balinese-python.ts.net";

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Reviewer Agent API token（支援舊名 COMPASS_API_TOKEN）。
 * @purpose AI review 與 compass provider LLM 認證。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function getReviewerAgentApiToken() {
  const envLocal = loadEnvLocal();
  return (
    pickFirstEnvString(
      process.env.REVIEWER_AGENT_API_TOKEN,
      envLocal.REVIEWER_AGENT_API_TOKEN,
      process.env.COMPASS_API_TOKEN,
      envLocal.COMPASS_API_TOKEN,
    ) || null
  );
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Compass API token（legacy alias）。
 * @purpose 維持既有 import 向下兼容。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
export function getCompassApiToken() {
  return getReviewerAgentApiToken();
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Reviewer Agent API base URL。
 * @purpose 未設定 REVIEWER_AGENT_API_URL 時預設 mac09demac-mini（Compass Reviewer）。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function getReviewerAgentApiBaseUrl() {
  const envLocal = loadEnvLocal();
  const configured = pickFirstEnvString(
    process.env.REVIEWER_AGENT_API_URL,
    envLocal.REVIEWER_AGENT_API_URL,
  );
  return normalizeEnvBaseUrl(
    configured || DEFAULT_REVIEWER_AGENT_API_URL,
  );
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 AI review jobs endpoint URL。
 * @purpose create-mr / update-mr 提交 code-review 任務。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function getReviewerAgentJobsUrl() {
  return `${getReviewerAgentApiBaseUrl()}/api/workflows/jobs`;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 operator-proxy endpoint URL。
 * @purpose compass LLM provider；優先沿用 COMPASS_OPERATOR_PROXY_URL 完整 URL。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
export function getReviewerAgentOperatorProxyUrl() {
  const envLocal = loadEnvLocal();
  const legacyFullUrl = pickFirstEnvString(
    process.env.COMPASS_OPERATOR_PROXY_URL,
    envLocal.COMPASS_OPERATOR_PROXY_URL,
  );
  if (legacyFullUrl) return legacyFullUrl;
  return `${getReviewerAgentApiBaseUrl()}/api/workflows/operator-proxy`;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Master Control Agent Log API URL（支援舊名 OPERATOR_AGENT_LOG_API_URL）。
 * @purpose llm-client 錯誤上報與 agent-log CLI 共用。
 * @external https://innotech.atlassian.net/browse/FE-8388
 */
export function getMasterControlAgentApiUrl() {
  const envLocal = loadEnvLocal();
  return (
    pickFirstEnvString(
      process.env.MASTER_CONTROL_AGENT_API_URL,
      envLocal.MASTER_CONTROL_AGENT_API_URL,
      process.env.OPERATOR_AGENT_LOG_API_URL,
      envLocal.OPERATOR_AGENT_LOG_API_URL,
    ) || null
  );
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 MR Reviewer（由環境變數或 loadEnvLocal 讀取）。
 * @purpose FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
export function getMRReviewer() {
  const envLocal = loadEnvLocal();
  return process.env.MR_REVIEWER || envLocal.MR_REVIEWER || null;
}

/**
 * 獲取 Figma Access Token（從環境變數或 .env.local）
 *
 * @param {string} defaultToken - 預設 token（可選）
 * @returns {string|null} Figma Access Token 或 null
 */
export function getFigmaToken(defaultToken = null) {
  const envLocal = loadEnvLocal();
  return (
    process.env.FIGMA_ACCESS_TOKEN ||
    envLocal.FIGMA_ACCESS_TOKEN ||
    defaultToken
  );
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得個性化 agent 顯示名稱；支援以 options.maxLength 控制字串長度（預設 40），空字串或非字串時回傳 null。
 * @purpose FE-8004
 * @external https://innotech.atlassian.net/browse/FE-8004
 */
export function getAgentDisplayName(options = {}) {
  const envLocal = loadEnvLocal();
  const raw = process.env.AGENT_DISPLAY_NAME ?? envLocal.AGENT_DISPLAY_NAME;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const maxLength =
    typeof options.maxLength === "number" && options.maxLength > 0
      ? options.maxLength
      : 40;

  if (trimmed.length > maxLength) return trimmed.slice(0, maxLength);
  return trimmed;
}

/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:29:34.408Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 新增 MASTER_CONTROL_AGENT_API_URL，保留 OPERATOR_AGENT_LOG_API_URL 向下兼容。
 */

#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/env-loader.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-7840
 * @external https://innotech.atlassian.net/browse/FE-8004
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-8513
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
 * @external https://innotech.atlassian.net/browse/FE-8513
 */

import {
  readFileSync,
  existsSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
} from "fs";
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
 * FE-8513: 同 key 多行時保留既有非空值，避免後續空行覆蓋預填結果
 */
function parseEnvContent(content) {
  const env = {};
  content.split("\n").forEach((line) => {
    line = line.trim();
    if (line && !line.startsWith("#")) {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        const trimmedKey = key.trim();
        const trimmedValue = valueParts
          .join("=")
          .trim()
          .replace(/^["']|["']$/g, "");
        const existing = env[trimmedKey];
        if (
          trimmedValue === "" &&
          typeof existing === "string" &&
          existing !== ""
        ) {
          return;
        }
        env[trimmedKey] = trimmedValue;
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
 * @description 解析 Pantheon 來源的 .env.system 路徑（掛載專案或 Pantheon 本 repo）。
 * @purpose oracle/descend 預填 .env.local 時讀取來源；不在目標專案建立 .env.system。
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function resolvePantheonEnvSystemPath(projectRoot = getProjectRoot()) {
  const mountedPantheonDir = join(projectRoot, ".pantheon");

  if (existsSync(mountedPantheonDir)) {
    const mountedPath = join(mountedPantheonDir, ".cursor", ".env.system");
    return existsSync(mountedPath) ? mountedPath : null;
  }

  const pantheonRepoPath = join(projectRoot, ".cursor", ".env.system");
  return existsSync(pantheonRepoPath) ? pantheonRepoPath : null;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 讀取 Pantheon 來源的 .env.system（.pantheon 或本 repo）。
 * @purpose 供 seedEnvLocalFromSystem 使用；runtime 腳本不直接讀取。
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function loadEnvSystem(projectRoot = getProjectRoot()) {
  const systemEnvPath = resolvePantheonEnvSystemPath(projectRoot);
  if (!systemEnvPath) {
    return {};
  }

  return parseEnvContent(readFileSync(systemEnvPath, "utf-8"));
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

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 將 Pantheon .env.system 的非空值預填至目標專案 .env.local；不覆寫 local 既有值。
 * @purpose FE-8513：同 key 多個空行一次全部預填，避免只填第一個導致 runtime 讀到空值
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function seedEnvLocalFromSystem(options = {}) {
  const projectRoot = getProjectRoot();
  const envLocalPath =
    options.envLocalPath ?? join(projectRoot, ".cursor", ".env.local");
  const envSystemPath =
    options.envSystemPath ?? resolvePantheonEnvSystemPath(projectRoot);

  if (!envSystemPath || !existsSync(envLocalPath)) {
    return { updated: false, filledKeys: [] };
  }

  const system = parseEnvContent(readFileSync(envSystemPath, "utf-8"));
  let content = readFileSync(envLocalPath, "utf-8");
  const local = parseEnvContent(content);
  const filledKeys = [];

  for (const [key, value] of Object.entries(system)) {
    const systemValue = pickFirstEnvString(value);
    if (!systemValue) continue;

    const localValue = pickFirstEnvString(local[key]);
    if (localValue) continue;

    const escapedKey = escapeRegExp(key);
    const uncommentedEmpty = new RegExp(`^(${escapedKey}=)\\s*$`, "gm");
    const nextUncommented = content.replace(
      uncommentedEmpty,
      `$1${systemValue}`,
    );

    if (nextUncommented !== content) {
      content = nextUncommented;
      filledKeys.push(key);
      local[key] = systemValue;
      continue;
    }

    const commentedEmpty = new RegExp(`^#\\s*(${escapedKey}=)\\s*$`, "gm");
    const nextCommented = content.replace(commentedEmpty, `$1${systemValue}`);

    if (nextCommented !== content) {
      content = nextCommented;
      filledKeys.push(key);
      local[key] = systemValue;
      continue;
    }

    if (!(key in local)) {
      content = `${content.trimEnd()}\n${key}=${systemValue}\n`;
      filledKeys.push(key);
      local[key] = systemValue;
    }
  }

  if (filledKeys.length > 0) {
    writeFileSync(envLocalPath, content, "utf-8");
    return { updated: true, filledKeys };
  }

  return { updated: false, filledKeys: [] };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description oracle/descend pull 後建立 .env.local、從 Pantheon .env.system 預填，並移除目標專案誤建的 .env.system。
 * @purpose FE-8513：動態載入確保 pull 後使用最新邏輯，避免舊版 oracle 記憶體內仍複製 .env.system。
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function runEnvOracleSetup(cwd, { log } = {}) {
  const logger = {
    success: (message) =>
      typeof log?.success === "function" ? log.success(message) : console.log(message),
    warning: (message) =>
      typeof log?.warning === "function"
        ? log.warning(message)
        : console.warn(message),
    dim: (message) =>
      typeof log?.dim === "function" ? log.dim(message) : console.log(message),
  };

  const envLocalPath = join(cwd, ".cursor", ".env.local");
  const envExamplePath = join(cwd, ".pantheon", ".cursor", ".env.example");
  const envSystemSourcePath = join(
    cwd,
    ".pantheon",
    ".cursor",
    ".env.system",
  );
  const hostEnvSystemPath = join(cwd, ".cursor", ".env.system");

  if (existsSync(hostEnvSystemPath)) {
    unlinkSync(hostEnvSystemPath);
    logger.success(
      "已移除目標專案 .cursor/.env.system（企業預設僅保留於 .pantheon）",
    );
  }

  let envCreated = false;

  if (!existsSync(envLocalPath)) {
    if (existsSync(envExamplePath)) {
      console.log("📝 建立環境變數配置檔...");
      copyFileSync(envExamplePath, envLocalPath);
      envCreated = true;
      logger.success("已建立 .cursor/.env.local");
    } else {
      logger.warning(".env.example 不存在，跳過建立 .env.local");
    }
  } else {
    logger.success(".cursor/.env.local 已存在");
  }

  if (existsSync(envSystemSourcePath) && existsSync(envLocalPath)) {
    const seedResult = seedEnvLocalFromSystem({
      envLocalPath,
      envSystemPath: envSystemSourcePath,
    });
    if (seedResult.updated) {
      logger.success(
        `已從 Pantheon .env.system 預填至 .env.local：${seedResult.filledKeys.join(", ")}`,
      );
    } else {
      logger.dim(".env.local 企業級欄位已齊，略過預填");
    }
  } else if (!existsSync(envSystemSourcePath)) {
    logger.warning(
      ".pantheon/.cursor/.env.system 不存在，略過企業級預填",
    );
  }

  return { envCreated };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 企業級 env 缺失時輸出設定指引。
 * @purpose FE-8513：提示於 .env.local 補齊（oracle 已從 .env.system 預填）。
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
function guideEnterpriseEnvConfig(keys, label) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  console.error(`\n❌ 缺少企業級環境變數：${label || keyList[0]}\n`);
  console.error("📝 請在 .cursor/.env.local 補齊：\n");
  for (const key of keyList) {
    console.error(`   ${key}=<value>`);
  }
  console.error("");
  console.error(
    "💡 若為組織共用預設值，請更新 Pantheon .env.system 後重新執行 pantheon:oracle / pantheon:descend 以預填至 .env.local\n",
  );
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 依 .env.local 解析 env；缺值且 required 時 throw。
 * @purpose FE-8513：runtime 僅讀 .env.local；企業預設由 oracle 從 .env.system 預填。
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function resolveEnvValue(key, options = {}) {
  const {
    required = true,
    legacyKeys = [],
    label = key,
    normalize = null,
  } = options;
  const keys = [key, ...legacyKeys];
  const local = loadEnvLocal();

  for (const envKey of keys) {
    const value = pickFirstEnvString(local[envKey]);
    if (value) {
      return typeof normalize === "function" ? normalize(value) : value;
    }
  }

  if (required) {
    guideEnterpriseEnvConfig(keys, label);
    throw new Error(
      `企業級環境變數缺失：${label || key}（請補齊 .cursor/.env.local）`,
    );
  }

  return null;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 當 Jira 需要的設定缺失時，透過終端提供使用者設定步驟提示。
 * @purpose FE-7892、FE-8513：補充 JIRA_BASE_URL 企業級設定指引
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-8513
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

  console.error("**3. 設置 Jira Base URL（企業級）:**");
  console.error("   在 .cursor/.env.local 添加（或重新執行 pantheon:oracle 以預填企業預設）:");
  console.error("   JIRA_BASE_URL=https://innotech.atlassian.net/");
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
 * @description 取得 Jira Base URL（僅讀 .env.local）。
 * @purpose FE-8513：Jira Base URL 改由 JIRA_BASE_URL env 解析，移除 innotech hardcode
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getJiraBaseUrl(options = {}) {
  const { required = true } = options;
  const baseUrl = resolveEnvValue("JIRA_BASE_URL", {
    required,
    label: "JIRA_BASE_URL（Jira Base URL）",
    normalize: (value) => {
      const trimmed = String(value || "").trim();
      return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    },
  });
  return baseUrl;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Jira 設定（email/apiToken/baseUrl 皆由 .env.local 讀取）。
 * @purpose FE-7892、FE-8513：baseUrl 改走 getJiraBaseUrl，不再 hardcode innotech URL
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getJiraConfig(throwOnMissing = true) {
  const envLocal = loadEnvLocal();
  const email = process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN || envLocal.JIRA_API_TOKEN;

  let baseUrl = null;
  try {
    baseUrl = getJiraBaseUrl({ required: throwOnMissing });
  } catch (error) {
    if (throwOnMissing) {
      guideJiraConfig();
      throw error;
    }
  }

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
 * @description 取得 Reviewer Agent API token（支援舊名 COMPASS_API_TOKEN）。
 * @purpose 僅供 AI review jobs API（create-mr / update-mr / fix-comment）；不得用於 LLM 呼叫。
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
 * @description 取得 Reviewer Agent API base URL（僅讀 .env.local）。
 * @purpose FE-8513：Reviewer API URL 改 resolveEnvValue，移除 DEFAULT_REVIEWER_AGENT_API_URL
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getReviewerAgentApiBaseUrl() {
  return normalizeEnvBaseUrl(
    resolveEnvValue("REVIEWER_AGENT_API_URL", {
      label: "REVIEWER_AGENT_API_URL",
    }),
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
 * @description 取得 Communicator Agent API base URL（僅讀 .env.local）。
 * @purpose FE-8513：新增 Communicator API URL getter，集中於 env-loader 解析
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getCommunicatorAgentApiUrl() {
  return normalizeEnvBaseUrl(
    resolveEnvValue("COMMUNICATOR_AGENT_API_URL", {
      label: "COMMUNICATOR_AGENT_API_URL",
    }),
  );
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Communicator Agent API token（僅讀 .env.local）。
 * @purpose FE-8513：新增 Communicator API token getter，集中於 env-loader 解析
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getCommunicatorAgentApiToken() {
  return resolveEnvValue("COMMUNICATOR_AGENT_API_TOKEN", {
    label: "COMMUNICATOR_AGENT_API_TOKEN",
  });
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Master Control Agent Log API URL（僅讀 .env.local；支援舊名）。
 * @purpose llm-client 錯誤上報與 agent-log CLI 共用；FE-8513 改走 resolveEnvValue
 * @external https://innotech.atlassian.net/browse/FE-8388
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getMasterControlAgentApiUrl(options = {}) {
  const { required = false } = options;
  return resolveEnvValue("MASTER_CONTROL_AGENT_API_URL", {
    required,
    legacyKeys: ["OPERATOR_AGENT_LOG_API_URL"],
    label: "MASTER_CONTROL_AGENT_API_URL",
  });
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 MR Reviewer（僅讀 .env.local）。
 * @purpose FE-8513：MR reviewer 改 resolveEnvValue，移除 create-mr @william.chiang hardcode
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getMRReviewer(options = {}) {
  const { required = true } = options;
  return resolveEnvValue("MR_REVIEWER", {
    required,
    label: "MR_REVIEWER",
  });
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 取得 Figma Access Token（僅讀 .env.local）。
 * @purpose FE-8513：Figma token 由 .env.local 解析（oracle 從 .env.system 預填）
 * @external https://innotech.atlassian.net/browse/FE-8513
 */
export function getFigmaAccessToken(options = {}) {
  const { required = true } = options;
  return resolveEnvValue("FIGMA_ACCESS_TOKEN", {
    required,
    label: "FIGMA_ACCESS_TOKEN",
  });
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
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-11T03:06:00.000Z
 * @llm-review-model grok-4.5
 * @llm-review-note FE-8513：修正 seed 同 key 多空行只填第一個，以及 parseEnvContent 空行覆蓋非空值。
 */

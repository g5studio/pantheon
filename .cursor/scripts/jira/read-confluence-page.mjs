#!/usr/bin/env node

/**
 * 讀取 Confluence 頁面內容
 * 使用 Jira API token 透過 Confluence API 訪問頁面
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 腳本在 .cursor/scripts/jira/，需要往上三層到項目根目錄
const projectRoot = join(__dirname, "../../..");

// 讀取 .env.local 文件
// 優先從項目根目錄讀取，如果不存在則從 .cursor/.env.local 讀取
function loadEnvLocal() {
  // 優先級 1: 項目根目錄的 .env.local
  let envLocalPath = join(projectRoot, ".env.local");

  // 優先級 2: .cursor/.env.local
  if (!existsSync(envLocalPath)) {
    envLocalPath = join(projectRoot, ".cursor", ".env.local");
  }

  if (!existsSync(envLocalPath)) {
    return {};
  }

  const envContent = readFileSync(envLocalPath, "utf-8");
  const env = {};
  envContent.split("\n").forEach((line) => {
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

// 獲取 Jira 配置（從環境變數或 .env.local 讀取）
function getJiraConfig() {
  const envLocal = loadEnvLocal();
  const email = process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN || envLocal.JIRA_API_TOKEN;
  // Base URL 固定為 innotech
  const baseUrl = "https://innotech.atlassian.net/";

  if (!email || !apiToken) {
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
    throw new Error("Jira 配置缺失，請檢查 .env.local 文件");
  }

  return {
    email,
    apiToken,
    baseUrl,
  };
}

// 從 Confluence URL 解析空間和頁面 ID
function parseConfluenceUrl(url) {
  // 格式: https://innotech.atlassian.net/wiki/spaces/{spaceKey}/pages/{pageId}/...
  const match = url.match(/\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)(?:\/|$)/);
  if (match) {
    return {
      spaceKey: match[1],
      pageId: match[2],
    };
  }
  return null;
}

// 提取 ADF 格式的文本內容
function extractTextFromADF(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.text) return item.text;
        if (item?.content) return extractTextFromADF(item.content);
        return "";
      })
      .join("\n");
  }
  if (content?.text) return content.text;
  if (content?.content) return extractTextFromADF(content.content);
  return "";
}

// 讀取 Confluence 頁面
async function readConfluencePage(url) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  // 解析 URL
  const parsed = parseConfluenceUrl(url);
  if (!parsed) {
    throw new Error(
      `無法解析 Confluence URL: ${url}\n格式應為: https://innotech.atlassian.net/wiki/spaces/{spaceKey}/pages/{pageId}/...`
    );
  }

  const { spaceKey, pageId } = parsed;

  // 使用 Confluence REST API 獲取頁面內容
  // API 端點: /wiki/rest/api/content/{id}?expand=body.storage,version
  const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,body.view,version,space`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Confluence 頁面: ${pageId}`);
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
      } else {
        throw new Error(
          `獲取 Confluence 頁面失敗: ${response.status} ${response.statusText}`
        );
      }
    }

    const data = await response.json();

    // 提取頁面信息
    const title = data.title || "無標題";
    const space = data.space?.name || spaceKey;
    const version = data.version?.number || 1;

    // 提取內容（優先使用 storage 格式，如果沒有則使用 view 格式）
    let content = "";
    if (data.body?.storage?.value) {
      // Storage 格式（ADF - Atlassian Document Format）
      try {
        const adfContent = JSON.parse(data.body.storage.value);
        content = extractTextFromADF(adfContent);
      } catch (e) {
        // 如果不是 JSON，可能是 HTML 或其他格式
        content = data.body.storage.value;
      }
    } else if (data.body?.view?.value) {
      // View 格式（HTML）
      content = data.body.view.value;
    } else if (data.body?.storage?.representation === "wiki") {
      // Wiki 格式
      content = data.body.storage.value || "";
    }

    return {
      url,
      pageId,
      spaceKey,
      space,
      title,
      version,
      content,
      raw: data, // 保留原始數據以便進一步處理
    };
  } catch (error) {
    if (error.message.includes("Jira API Token")) {
      throw error;
    }
    throw new Error(`讀取 Confluence 頁面失敗: ${error.message}`);
  }
}

// 主函數
async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error("❌ 請提供 Confluence 頁面 URL");
    console.error("\n使用方法:");
    console.error("  node read-confluence-page.mjs <confluence-url>");
    console.error("\n範例:");
    console.error(
      '  node read-confluence-page.mjs "https://innotech.atlassian.net/wiki/spaces/Frontend/pages/4078010378/Agent+Operator+Guideline"'
    );
    process.exit(1);
  }

  try {
    const result = await readConfluencePage(url);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

/**
 * STG 部署資訊腳本
 * 從 Jira filter 15608 取得所有 issues，按 type 分類產生報告
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 腳本在 .cursor/scripts/jira/，需要往上三層到項目根目錄
const projectRoot = join(__dirname, "../../..");

const FILTER_ID = "15608";
const BASE_URL = "https://innotech.atlassian.net";

// 讀取 .env.local 文件
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

// 獲取 Jira 配置
function getJiraConfig() {
  const envLocal = loadEnvLocal();
  const email = process.env.JIRA_EMAIL || envLocal.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN || envLocal.JIRA_API_TOKEN;

  if (!email || !apiToken) {
    console.error("\n❌ Jira 配置缺失！\n");
    console.error("📝 請按照以下步驟設置 Jira 配置：\n");
    console.error("**1. 設置 Jira Email:**");
    console.error("   在 .env.local 文件中添加:");
    console.error("   JIRA_EMAIL=your-email@example.com\n");
    console.error("**2. 設置 Jira API Token:**");
    console.error(
      "   前往: https://id.atlassian.com/manage-profile/security/api-tokens"
    );
    console.error("   創建 token 後，在 .env.local 中添加:");
    console.error("   JIRA_API_TOKEN=your-api-token\n");
    throw new Error("Jira 配置缺失");
  }

  return { email, apiToken };
}

// 獲取 Filter 的 JQL
async function getFilterJql(filterId, auth) {
  const filterUrl = `${BASE_URL}/rest/api/2/filter/${filterId}`;

  const response = await fetch(filterUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`無法取得 filter ${filterId}: ${response.status}`);
  }

  const data = await response.json();
  return data.jql;
}

// 使用 JQL 搜尋 issues
async function searchIssues(jql, auth, maxResults = 1000) {
  const searchUrl = `${BASE_URL}/rest/api/3/search`;

  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql,
      maxResults,
      fields: ["key", "issuetype", "summary"],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`搜尋 issues 失敗: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.issues || [];
}

// 按類型分組 issues
function groupIssuesByType(issues) {
  const grouped = {};

  for (const issue of issues) {
    const typeName = issue.fields?.issuetype?.name || "Unknown";
    if (!grouped[typeName]) {
      grouped[typeName] = [];
    }
    grouped[typeName].push({
      key: issue.key,
      summary: issue.fields?.summary || "",
    });
  }

  // 對每個類型內的 issues 按 key 排序
  for (const typeName of Object.keys(grouped)) {
    grouped[typeName].sort((a, b) => a.key.localeCompare(b.key));
  }

  return grouped;
}

// 產生 Markdown 報告
function generateReport(issuesByType, filterId) {
  const lines = [];

  // 添加生成時間資訊
  const currentTime = new Date().toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  lines.push(`> 生成時間：${currentTime}`);

  // 添加 filter 資訊
  const filterUrl = `${BASE_URL}/issues/?filter=${filterId}`;
  lines.push(`> Filter: [點擊此處在 Jira 中查看 filter](${filterUrl})`);
  lines.push("");

  // 功能釋出（Request）
  if (issuesByType["Request"]) {
    lines.push("## 功能釋出：");
    lines.push("");
    for (const issue of issuesByType["Request"]) {
      const issueUrl = `${BASE_URL}/browse/${issue.key}`;
      lines.push(issueUrl);
    }
    lines.push("");
  }

  // 問題修復（Bug）
  if (issuesByType["Bug"]) {
    lines.push("## 問題修復：");
    lines.push("");
    for (const issue of issuesByType["Bug"]) {
      const issueUrl = `${BASE_URL}/browse/${issue.key}`;
      lines.push(issueUrl);
    }
    lines.push("");
  }

  // 其他類型
  const otherTypes = Object.keys(issuesByType).filter(
    (t) => t !== "Request" && t !== "Bug"
  );
  for (const typeName of otherTypes.sort()) {
    lines.push(`## ${typeName}：`);
    lines.push("");
    for (const issue of issuesByType[typeName]) {
      const issueUrl = `${BASE_URL}/browse/${issue.key}`;
      lines.push(issueUrl);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// 主函數
async function main() {
  console.log("=".repeat(50));
  console.log("STG 部署資訊查詢");
  console.log("=".repeat(50));
  console.log(`Filter ID: ${FILTER_ID}`);

  try {
    // 獲取配置
    const config = getJiraConfig();
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    );

    // 取得 filter 的 JQL
    console.log(`\n取得 filter ${FILTER_ID} 的 JQL...`);
    const jql = await getFilterJql(FILTER_ID, auth);
    console.log(`Filter JQL: ${jql}`);

    // 搜尋 issues
    console.log(`\n搜尋 issues...`);
    const issues = await searchIssues(jql, auth);
    console.log(`找到 ${issues.length} 個 issues`);

    if (issues.length === 0) {
      console.log("沒有找到任何 issues");
      return;
    }

    // 按類型分組
    const issuesByType = groupIssuesByType(issues);
    console.log("\n按類型分類：");
    for (const [typeName, typeIssues] of Object.entries(issuesByType).sort()) {
      console.log(`  - ${typeName}: ${typeIssues.length} 個`);
    }

    // 產生報告
    const report = generateReport(issuesByType, FILTER_ID);

    const totalCount = issues.length;
    console.log(`\n✓ 共找到 ${totalCount} 個 issues`);
    if (issuesByType["Request"]) {
      console.log(
        `  - 功能釋出（Request）: ${issuesByType["Request"].length} 個`
      );
    }
    if (issuesByType["Bug"]) {
      console.log(`  - 問題修復（Bug）: ${issuesByType["Bug"].length} 個`);
    }

    // 輸出報告到 console
    console.log("\n" + "=".repeat(50));
    console.log("報告內容：");
    console.log("=".repeat(50));
    console.log(report);
  } catch (error) {
    console.error(`\n❌ 錯誤: ${error.message}`);
    process.exit(1);
  }
}

main();

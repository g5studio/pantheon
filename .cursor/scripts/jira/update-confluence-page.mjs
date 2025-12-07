#!/usr/bin/env node

/**
 * 更新 Confluence 頁面內容
 * 使用 Jira API token 透過 Confluence API 更新頁面
 *
 * 使用方法:
 *   node update-confluence-page.mjs <confluence-url> [options]
 *
 * 選項:
 *   --content=<file>     從檔案讀取內容（支援 .md, .html, .txt）
 *   --stdin              從 stdin 讀取內容
 *   --title=<title>      更新頁面標題
 *   --draft              建立 Draft 版本（不會自動發布）
 *   --minor              標記為小幅修改（不通知關注者）
 *   --message=<message>  版本更新訊息
 *   --dry-run            預覽模式，不實際更新
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../../..");

// 讀取 .env.local 文件
function loadEnvLocal() {
  let envLocalPath = join(projectRoot, ".env.local");

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
  const baseUrl = "https://innotech.atlassian.net/";

  if (!email || !apiToken) {
    console.error("\n❌ Jira 配置缺失！\n");
    console.error("📝 請按照以下步驟設置 Jira 配置：\n");
    console.error("**1. 設置 Jira Email:**");
    console.error("   在 .env.local 文件中添加:");
    console.error("   JIRA_EMAIL=your-email@example.com\n");
    console.error("**2. 設置 Jira API Token:**");
    console.error(
      "   1. 前往: https://id.atlassian.com/manage-profile/security/api-tokens"
    );
    console.error('   2. 點擊 "Create API token"');
    console.error("   3. 複製生成的 token");
    console.error("   4. 在 .env.local 文件中添加:");
    console.error("      JIRA_API_TOKEN=your-api-token\n");
    throw new Error("Jira 配置缺失，請檢查 .env.local 文件");
  }

  return { email, apiToken, baseUrl };
}

// 從 Confluence URL 解析頁面 ID
function parseConfluenceUrl(url) {
  const match = url.match(/\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)(?:\/|$)/);
  if (match) {
    return {
      spaceKey: match[1],
      pageId: match[2],
    };
  }
  return null;
}

// 解析命令行參數
function parseArgs(args) {
  const options = {
    url: null,
    contentFile: null,
    stdin: false,
    title: null,
    draft: false,
    minor: false,
    message: "",
    dryRun: false,
    content: null,
  };

  for (const arg of args) {
    if (arg.startsWith("--content=")) {
      options.contentFile = arg.slice("--content=".length);
    } else if (arg === "--stdin") {
      options.stdin = true;
    } else if (arg.startsWith("--title=")) {
      options.title = arg.slice("--title=".length);
    } else if (arg === "--draft") {
      options.draft = true;
    } else if (arg === "--minor") {
      options.minor = true;
    } else if (arg.startsWith("--message=")) {
      options.message = arg.slice("--message=".length);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (!arg.startsWith("--") && !options.url) {
      options.url = arg;
    }
  }

  return options;
}

// 從 stdin 讀取內容
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", reject);
  });
}

// Markdown 轉換為 Confluence Storage Format (XHTML)
function markdownToConfluence(markdown) {
  let html = markdown;

  // 標題轉換
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // 粗體和斜體
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // 行內程式碼
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 程式碼區塊
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || "text";
    return `<ac:structured-macro ac:name="code" ac:schema-version="1">
<ac:parameter ac:name="language">${language}</ac:parameter>
<ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body>
</ac:structured-macro>`;
  });

  // 連結
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 無序列表
  html = html.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // 有序列表
  html = html.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

  // 引用
  html = html.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // 水平線
  html = html.replace(/^---+$/gm, "<hr />");

  // 表格轉換
  html = convertTables(html);

  // 段落（處理剩餘的純文本行）
  const lines = html.split("\n");
  const processedLines = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inParagraph) {
        processedLines.push("</p>");
        inParagraph = false;
      }
      processedLines.push("");
    } else if (
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<ul") ||
      trimmed.startsWith("<ol") ||
      trimmed.startsWith("<li") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<hr") ||
      trimmed.startsWith("<ac:") ||
      trimmed.startsWith("<table") ||
      trimmed.startsWith("</")
    ) {
      if (inParagraph) {
        processedLines.push("</p>");
        inParagraph = false;
      }
      processedLines.push(line);
    } else {
      if (!inParagraph) {
        processedLines.push("<p>" + trimmed);
        inParagraph = true;
      } else {
        processedLines.push(trimmed);
      }
    }
  }
  if (inParagraph) {
    processedLines.push("</p>");
  }

  return processedLines.join("\n");
}

// 表格轉換
function convertTables(html) {
  const lines = html.split("\n");
  const result = [];
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 檢測表格行（以 | 開始和結束）
    if (line.startsWith("|") && line.endsWith("|")) {
      // 跳過分隔行（如 |---|---|）
      if (line.match(/^\|[\s\-:]+\|$/)) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableRows = [];
      }

      // 解析表格單元格
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
      tableRows.push(cells);
    } else {
      if (inTable) {
        // 結束表格
        result.push(buildConfluenceTable(tableRows));
        inTable = false;
        tableRows = [];
      }
      result.push(lines[i]);
    }
  }

  if (inTable) {
    result.push(buildConfluenceTable(tableRows));
  }

  return result.join("\n");
}

// 建構 Confluence 表格
function buildConfluenceTable(rows) {
  if (rows.length === 0) return "";

  let table = '<table data-layout="default"><tbody>';

  rows.forEach((cells, rowIndex) => {
    table += "<tr>";
    cells.forEach((cell) => {
      // 第一行作為表頭
      const tag = rowIndex === 0 ? "th" : "td";
      table += `<${tag}><p>${cell}</p></${tag}>`;
    });
    table += "</tr>";
  });

  table += "</tbody></table>";
  return table;
}

// 獲取當前頁面信息
async function getPageInfo(pageId, auth, baseUrl) {
  const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=version,space,body.storage`;

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
      throw new Error("Jira API Token 已過期或無權限");
    }
    throw new Error(
      `獲取頁面信息失敗: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

// 更新 Confluence 頁面
async function updateConfluencePage(options) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  // 解析 URL
  const parsed = parseConfluenceUrl(options.url);
  if (!parsed) {
    throw new Error(
      `無法解析 Confluence URL: ${options.url}\n格式應為: https://innotech.atlassian.net/wiki/spaces/{spaceKey}/pages/{pageId}/...`
    );
  }

  const { pageId, spaceKey } = parsed;

  // 獲取當前頁面信息
  console.log("📖 正在獲取頁面信息...");
  const currentPage = await getPageInfo(pageId, auth, baseUrl);
  const currentVersion = currentPage.version.number;
  const currentTitle = currentPage.title;

  console.log(`   標題: ${currentTitle}`);
  console.log(`   當前版本: v${currentVersion}`);
  console.log(`   空間: ${currentPage.space?.name || spaceKey}`);

  // 獲取要更新的內容
  let newContent = options.content;

  if (options.contentFile) {
    if (!existsSync(options.contentFile)) {
      throw new Error(`找不到檔案: ${options.contentFile}`);
    }
    newContent = readFileSync(options.contentFile, "utf-8");
    console.log(`📄 從檔案讀取內容: ${options.contentFile}`);

    // 根據檔案類型轉換格式
    const ext = extname(options.contentFile).toLowerCase();
    if (ext === ".md") {
      console.log("🔄 轉換 Markdown 為 Confluence 格式...");
      newContent = markdownToConfluence(newContent);
    }
  } else if (options.stdin) {
    console.log("📥 從 stdin 讀取內容...");
    newContent = await readStdin();
  }

  if (!newContent) {
    throw new Error("未提供更新內容。請使用 --content=<file> 或 --stdin 選項");
  }

  const newTitle = options.title || currentTitle;
  const newVersion = currentVersion + 1;

  // Dry run 模式
  if (options.dryRun) {
    console.log("\n🔍 預覽模式（不會實際更新）");
    console.log("━".repeat(50));
    console.log(`標題: ${newTitle}`);
    console.log(`新版本: v${newVersion}`);
    console.log(`Draft: ${options.draft ? "是" : "否"}`);
    console.log(`小幅修改: ${options.minor ? "是" : "否"}`);
    console.log(`版本訊息: ${options.message || "(無)"}`);
    console.log("━".repeat(50));
    console.log("內容預覽（前 500 字元）:");
    console.log(
      newContent.slice(0, 500) + (newContent.length > 500 ? "..." : "")
    );
    return {
      success: true,
      dryRun: true,
      pageId,
      title: newTitle,
      version: newVersion,
    };
  }

  // 建構更新請求
  const updatePayload = {
    id: pageId,
    type: "page",
    title: newTitle,
    space: {
      key: spaceKey,
    },
    body: {
      storage: {
        value: newContent,
        representation: "storage",
      },
    },
    version: {
      number: newVersion,
      minorEdit: options.minor,
      message: options.message || "",
    },
  };

  // 如果是 Draft 模式，使用不同的 API
  if (options.draft) {
    console.log("\n📝 建立 Draft 版本...");
    // Confluence Cloud 的 Draft 是透過建立一個新的 draft 頁面
    // 或者使用 status=draft 參數
    updatePayload.status = "draft";
  } else {
    console.log("\n📤 正在更新頁面...");
  }

  const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}`;

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `更新失敗: ${response.status} ${response.statusText}`;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.message) {
        errorMessage += `\n${errorJson.message}`;
      }
    } catch (e) {
      errorMessage += `\n${errorText}`;
    }

    throw new Error(errorMessage);
  }

  const result = await response.json();

  console.log("\n✅ 更新成功！");
  console.log("━".repeat(50));
  console.log(`標題: ${result.title}`);
  console.log(`版本: v${result.version.number}`);
  console.log(`狀態: ${result.status}`);
  console.log(
    `連結: ${baseUrl}/wiki/spaces/${spaceKey}/pages/${pageId}/${encodeURIComponent(
      result.title
    )}`
  );

  return {
    success: true,
    pageId,
    title: result.title,
    version: result.version.number,
    status: result.status,
    url: `${baseUrl}/wiki/spaces/${spaceKey}/pages/${pageId}/${encodeURIComponent(
      result.title
    )}`,
  };
}

// 顯示使用說明
function showHelp() {
  console.log(`
📝 Confluence 頁面更新工具

使用方法:
  node update-confluence-page.mjs <confluence-url> [options]

選項:
  --content=<file>     從檔案讀取內容（支援 .md, .html, .txt）
  --stdin              從 stdin 讀取內容
  --title=<title>      更新頁面標題
  --draft              建立 Draft 版本（不會自動發布）
  --minor              標記為小幅修改（不通知關注者）
  --message=<message>  版本更新訊息
  --dry-run            預覽模式，不實際更新

範例:
  # 從 Markdown 檔案更新頁面
  node update-confluence-page.mjs "https://innotech.atlassian.net/wiki/spaces/Frontend/pages/123456" --content=./doc.md

  # 建立 Draft 版本
  node update-confluence-page.mjs "https://..." --content=./doc.md --draft

  # 從 stdin 讀取內容
  cat doc.html | node update-confluence-page.mjs "https://..." --stdin

  # 預覽模式
  node update-confluence-page.mjs "https://..." --content=./doc.md --dry-run

  # 更新標題和內容
  node update-confluence-page.mjs "https://..." --content=./doc.md --title="新標題" --message="更新內容"
`);
}

// 主函數
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const options = parseArgs(args);

  if (!options.url) {
    console.error("❌ 請提供 Confluence 頁面 URL");
    showHelp();
    process.exit(1);
  }

  try {
    const result = await updateConfluencePage(options);
    console.log("\n" + JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n❌ " + error.message);
    process.exit(1);
  }
}

main();

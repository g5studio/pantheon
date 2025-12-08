#!/usr/bin/env node

/**
 * 在 Jira task 中添加 tag 超連結評論腳本
 * 依序到指定的 jira task 中以超連結留言 tag
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 腳本在 .cursor/scripts/jira/，需要往上三層到項目根目錄
const projectRoot = join(__dirname, "../../..");

const BASE_URL = "https://innotech.atlassian.net";

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

// 從 Jira URL 中提取 task key
function extractTaskKeyFromUrl(url) {
  // 匹配 /browse/TASK-KEY 格式
  const match = url.match(/\/browse\/([A-Z]+-\d+)/);
  if (match) {
    return match[1];
  }

  // 如果直接是 task key 格式，直接返回
  if (/^[A-Z]+-\d+/.test(url.trim())) {
    return url.trim();
  }

  return null;
}

// 從 GitLab tag URL 中提取 tag 名稱
function extractTagFromUrl(url) {
  // 匹配 /tags/TAG-NAME 格式
  const match = url.match(/\/tags\/([^/?]+)/);
  if (match) {
    return match[1];
  }
  return null;
}

// 解析 task 清單
function parseTaskList(taskInput) {
  const trimmed = taskInput.trim();

  let tasks;
  if (trimmed.includes(",")) {
    tasks = trimmed.split(",").map((t) => t.trim());
  } else if (trimmed.includes("\n")) {
    tasks = trimmed
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  } else {
    tasks = trimmed.split(/\s+/);
  }

  const validTasks = [];
  for (const task of tasks) {
    const trimmedTask = task.trim();
    if (trimmedTask && /^[A-Z]+-\d+/.test(trimmedTask)) {
      validTasks.push(trimmedTask);
    } else if (trimmedTask) {
      console.log(`警告: 跳過無效的 task key 格式: ${trimmedTask}`);
    }
  }

  return validTasks;
}

// 解析 tag 與 URL 對應關係
function parseTagMapping(tagInput) {
  const tagMapping = {};
  const lines = tagInput.trim().split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let tag, url;

    // 嘗試用冒號分隔（注意 URL 中也有冒號）
    if (trimmedLine.includes("http")) {
      // 找到 http 或 https 的位置
      const httpIndex = trimmedLine.indexOf("http");
      if (httpIndex > 0) {
        const separator = trimmedLine.charAt(httpIndex - 1);
        if (separator === ":" || separator === "=") {
          tag = trimmedLine.slice(0, httpIndex - 1).trim();
          url = trimmedLine.slice(httpIndex).trim();
        }
      }
    }

    // 如果上面的方法沒有成功，嘗試用等號分隔
    if (!tag && trimmedLine.includes("=")) {
      const parts = trimmedLine.split("=");
      tag = parts[0].trim();
      url = parts.slice(1).join("=").trim();
    }

    if (!tag || !url) {
      console.log(`警告: 跳過無效的 tag 對應格式: ${trimmedLine}`);
      continue;
    }

    tagMapping[tag] = url;
  }

  return tagMapping;
}

// 驗證 tag 和 URL 是否匹配
function validateTagUrl(tag, tagUrl) {
  try {
    new URL(tagUrl);
  } catch {
    return { valid: false, error: `URL 格式無效: ${tagUrl}` };
  }

  const tagLower = tag.toLowerCase();
  const urlLower = tagUrl.toLowerCase();

  if (!urlLower.includes(tagLower)) {
    return {
      valid: false,
      error: `URL 中未找到 tag 名稱 '${tag}'，請確認 URL 是否正確`,
    };
  }

  return { valid: true, error: null };
}

// 驗證所有 tags
function validateAllTags(tagMapping) {
  const invalidTags = [];

  for (const [tag, url] of Object.entries(tagMapping)) {
    const result = validateTagUrl(tag, url);
    if (!result.valid) {
      invalidTags.push({ tag, url, error: result.error });
    }
  }

  return {
    valid: invalidTags.length === 0,
    invalidTags,
  };
}

// 格式化評論內容（Jira 標記語言的超連結格式）
function formatComment(tag, tagUrl) {
  // Jira 超連結格式：[text|url]
  return `[${tag}|${tagUrl}]`;
}

// 添加評論到 Jira issue
async function addComment(issueKey, commentBody, auth) {
  const url = `${BASE_URL}/rest/api/3/issue/${issueKey}/comment`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: commentBody,
              },
            ],
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`添加評論失敗: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// 測試 Jira 連線
async function testConnection(auth) {
  const url = `${BASE_URL}/rest/api/3/myself`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`連線測試失敗: ${response.status}`);
  }

  const data = await response.json();
  console.log(`✓ 成功連線到 Jira，當前用戶: ${data.displayName}`);
  return true;
}

// 創建 readline 接口
function createReadlineInterface() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

// 提示用戶輸入
function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// 解析命令行參數
function parseArgs() {
  const args = {
    taskUrl: null,
    tagUrl: null,
    tasks: null,
    tags: null,
    yes: false,
  };

  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--task-url" && argv[i + 1]) {
      args.taskUrl = argv[++i];
    } else if (arg.startsWith("--task-url=")) {
      args.taskUrl = arg.split("=").slice(1).join("=");
    } else if (arg === "--tag-url" && argv[i + 1]) {
      args.tagUrl = argv[++i];
    } else if (arg.startsWith("--tag-url=")) {
      args.tagUrl = arg.split("=").slice(1).join("=");
    } else if (arg === "--tasks" && argv[i + 1]) {
      args.tasks = argv[++i];
    } else if (arg.startsWith("--tasks=")) {
      args.tasks = arg.split("=").slice(1).join("=");
    } else if (arg === "--tags" && argv[i + 1]) {
      args.tags = argv[++i];
    } else if (arg.startsWith("--tags=")) {
      args.tags = arg.split("=").slice(1).join("=");
    } else if (arg === "--yes" || arg === "-y") {
      args.yes = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

// 打印幫助信息
function printHelp() {
  console.log(`
在 Jira task 中添加 tag 超連結評論

使用方法：
  node left-tag-info.mjs [選項]

選項：
  --task-url <url>    Jira task URL（例如：https://innotech.atlassian.net/browse/IN-100005）
  --tag-url <url>     GitLab tag URL（例如：https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/sit-5.35.0-z）
  --tasks <tasks>     Task 清單（逗號分隔、空格分隔或換行分隔）
  --tags <tags>       Tag 與 URL 對應（格式：tag:url，多個用換行分隔）
  --yes, -y           跳過確認提示，直接執行
  --help, -h          顯示此幫助信息

範例：
  # 互動式模式
  node left-tag-info.mjs

  # 命令行模式：提供 task URL 和 tag URL
  node left-tag-info.mjs --task-url "https://innotech.atlassian.net/browse/IN-100005" \\
                         --tag-url "https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/sit-5.35.0-z"

  # 命令行模式：提供 task key 和 tag:url 對應
  node left-tag-info.mjs --tasks "IN-100005" \\
                         --tags "sit-5.35.0-z:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/sit-5.35.0-z"
`);
}

// 互動式輸入
async function promptUserInput(rl) {
  console.log("=".repeat(50));
  console.log("在 Jira task 中添加 tag 超連結評論");
  console.log("=".repeat(50));

  // 詢問 task 清單
  console.log("\n請輸入 Jira task 清單：");
  console.log(
    "（支援格式：逗號分隔、空格分隔或換行分隔，例如：IN-123, FE-456, IN-789）"
  );
  console.log("（輸入完成後按 Enter（空行）結束，或輸入 'END' 結束）");

  const taskLines = [];
  while (true) {
    const line = await prompt(rl, "");
    if (!line.trim() || line.trim().toUpperCase() === "END") {
      break;
    }
    taskLines.push(line);
  }

  const taskInput = taskLines.join("\n");
  const taskList = parseTaskList(taskInput);

  if (taskList.length === 0) {
    throw new Error("未提供有效的 task 清單");
  }

  console.log(`\n✓ 已解析 ${taskList.length} 個 task:`);
  for (const task of taskList) {
    console.log(`  - ${task}`);
  }

  // 詢問 tag 與 URL 對應
  console.log("\n請輸入 tag 與對應的 tag URL：");
  console.log("（格式：tag:url 或 tag=url，每行一個對應）");
  console.log(
    "（例如：release-5.34.24:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24）"
  );
  console.log("（輸入完成後按 Enter（空行）結束，或輸入 'END' 結束）");

  const tagLines = [];
  while (true) {
    const line = await prompt(rl, "");
    if (!line.trim() || line.trim().toUpperCase() === "END") {
      break;
    }
    tagLines.push(line);
  }

  const tagInput = tagLines.join("\n");
  const tagMapping = parseTagMapping(tagInput);

  if (Object.keys(tagMapping).length === 0) {
    throw new Error("未提供有效的 tag 與 URL 對應");
  }

  console.log(`\n✓ 已解析 ${Object.keys(tagMapping).length} 個 tag 對應:`);
  for (const [tag, url] of Object.entries(tagMapping)) {
    console.log(`  - ${tag}: ${url}`);
  }

  return { taskList, tagMapping };
}

// 主函數
async function main() {
  const args = parseArgs();
  let rl = null;

  try {
    // 獲取配置
    const config = getJiraConfig();
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    );

    // 測試連線
    await testConnection(auth);

    let taskList = null;
    let tagMapping = null;

    // 命令行模式：使用 URL
    if (args.taskUrl && args.tagUrl) {
      const taskKey = extractTaskKeyFromUrl(args.taskUrl);
      if (!taskKey) {
        throw new Error(`無法從 URL 中提取 task key: ${args.taskUrl}`);
      }

      const tag = extractTagFromUrl(args.tagUrl);
      if (!tag) {
        throw new Error(`無法從 URL 中提取 tag: ${args.tagUrl}`);
      }

      taskList = [taskKey];
      tagMapping = { [tag]: args.tagUrl };
      console.log(`✓ 從 URL 提取 task: ${taskKey}`);
      console.log(`✓ 從 URL 提取 tag: ${tag}`);
    }
    // 命令行模式：使用直接參數
    else if (args.tasks || args.tags) {
      if (!args.tasks) {
        throw new Error("請提供 --tasks 參數");
      }
      if (!args.tags) {
        throw new Error("請提供 --tags 參數");
      }

      taskList = parseTaskList(args.tasks);
      tagMapping = parseTagMapping(args.tags);
    }
    // 互動式模式
    else {
      rl = createReadlineInterface();
      const input = await promptUserInput(rl);
      taskList = input.taskList;
      tagMapping = input.tagMapping;
    }

    // 驗證所有 tag 與 URL 的對應關係
    console.log("\n正在驗證 tag 與 URL 的對應關係...");
    const validation = validateAllTags(tagMapping);

    if (!validation.valid) {
      console.log(
        `\n⚠️  發現 ${validation.invalidTags.length} 個 tag 與 URL 不匹配`
      );
      for (const { tag, url, error } of validation.invalidTags) {
        console.log(`  - ${tag}: ${error}`);
      }
      throw new Error("Tag 驗證失敗，請檢查後重試");
    }

    console.log("✓ 所有 tag 驗證通過");

    // 確認操作
    console.log("\n" + "=".repeat(50));
    console.log("準備在以下 task 中添加評論：");
    console.log("=".repeat(50));
    for (const task of taskList) {
      console.log(`  - ${task}`);
    }

    console.log("\n將添加以下 tag 超連結：");
    for (const [tag, url] of Object.entries(tagMapping)) {
      console.log(`  - ${tag}: ${url}`);
    }

    // 如果不是 --yes 模式，詢問確認
    if (!args.yes) {
      if (!rl) {
        rl = createReadlineInterface();
      }
      const confirm = await prompt(rl, "\n確認執行？(y/n): ");
      if (confirm.trim().toLowerCase() !== "y") {
        console.log("已取消操作");
        rl.close();
        return;
      }
    }

    // 依序添加評論
    console.log("\n開始添加評論...");
    let successCount = 0;
    let failCount = 0;

    for (const task of taskList) {
      for (const [tag, tagUrl] of Object.entries(tagMapping)) {
        try {
          const commentBody = formatComment(tag, tagUrl);
          await addComment(task, commentBody, auth);
          console.log(`✓ 已在 ${task} 中添加 tag 評論: ${tag}`);
          successCount++;
        } catch (error) {
          console.log(`✗ 無法在 ${task} 中添加評論: ${error.message}`);
          failCount++;
        }
      }
    }

    // 顯示結果摘要
    console.log("\n" + "=".repeat(50));
    console.log("操作完成");
    console.log("=".repeat(50));
    console.log(`成功: ${successCount} 個評論`);
    if (failCount > 0) {
      console.log(`失敗: ${failCount} 個評論`);
    }

    if (rl) {
      rl.close();
    }
  } catch (error) {
    console.error(`\n❌ 錯誤: ${error.message}`);
    if (rl) {
      rl.close();
    }
    process.exit(1);
  }
}

main();

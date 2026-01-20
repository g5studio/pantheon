#!/usr/bin/env node

/**
 * 新增 Jira ticket 留言
 * 使用 Jira API token 透過 API 在 ticket 上新增評論
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";

// 從 Jira URL 解析 ticket ID
function parseJiraUrl(url) {
  // 格式: https://innotech.atlassian.net/browse/{ticket} 或直接是 ticket ID
  if (!url.includes("/")) {
    // 直接是 ticket ID
    return url.toUpperCase();
  }

  const match = url.match(/\/browse\/([A-Z0-9]+-\d+)/);
  if (match) {
    return match[1];
  }

  // 嘗試直接匹配 ticket 格式
  const ticketMatch = url.match(/([A-Z0-9]+-\d+)/);
  if (ticketMatch) {
    return ticketMatch[1];
  }

  return null;
}

/**
 * 將純文字轉換為 ADF (Atlassian Document Format) 格式
 * @param {string} text - 純文字內容
 * @returns {Object} ADF 格式的文件物件
 */
function normalizePipeRowCells(line) {
  // 支援以下格式：
  // | a | b |
  // a | b
  // | a | b
  // a | b |
  const trimmed = (line ?? "").trim();
  if (!trimmed.includes("|")) return null;

  const parts = trimmed.split("|").map((s) => s.trim());
  // 移除因 leading/trailing pipe 造成的空白 cell
  if (parts.length > 0 && parts[0] === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();

  if (parts.length === 0) return null;
  return parts;
}

function isMarkdownTableSeparatorLine(line, expectedCols) {
  const cells = normalizePipeRowCells(line);
  if (!cells) return false;
  if (typeof expectedCols === "number" && cells.length !== expectedCols) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function makeAdfTextParagraph(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    // 空 cell：用空段落，避免 ADF schema 不接受完全空 content
    return { type: "paragraph", content: [] };
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: trimmed }],
  };
}

function markdownPipeTableToADF(paragraph) {
  const lines = (paragraph ?? "")
    .split(/\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  // 最小結構：header + separator
  if (lines.length < 2) return null;

  const headerCells = normalizePipeRowCells(lines[0]);
  if (!headerCells) return null;

  // 第二行必須是 separator line
  if (!isMarkdownTableSeparatorLine(lines[1], headerCells.length)) return null;

  // 後續每一行也必須是 table row（pipe row）
  const bodyRowCells = [];
  for (let i = 2; i < lines.length; i++) {
    const row = normalizePipeRowCells(lines[i]);
    if (!row) return null;
    bodyRowCells.push(row);
  }

  const colCount = headerCells.length;

  const headerRow = {
    type: "tableRow",
    content: headerCells.map((cell) => ({
      type: "tableHeader",
      content: [makeAdfTextParagraph(cell)],
    })),
  };

  const rows = bodyRowCells.map((cells) => {
    const normalized = cells.slice(0, colCount);
    while (normalized.length < colCount) normalized.push("");

    return {
      type: "tableRow",
      content: normalized.map((cell) => ({
        type: "tableCell",
        content: [makeAdfTextParagraph(cell)],
      })),
    };
  });

  return {
    type: "table",
    // attrs 可省略；保留最小可用結構，避免不同 Jira schema 差異
    content: [headerRow, ...rows],
  };
}

function textToADF(text) {
  // 將文字按換行符分割成段落
  const paragraphs = text.split(/\n\n+/);

  const content = paragraphs.map((paragraph) => {
    // 1) 優先嘗試：Markdown pipe table → ADF table
    const tableNode = markdownPipeTableToADF(paragraph);
    if (tableNode) {
      return tableNode;
    }

    // 處理段落內的換行（單個換行符）
    const lines = paragraph.split(/\n/);

    if (lines.length === 1) {
      // 單行段落
      return {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: paragraph,
          },
        ],
      };
    }

    // 多行段落，使用 hardBreak 處理換行
    const lineContent = [];
    lines.forEach((line, index) => {
      if (index > 0) {
        lineContent.push({ type: "hardBreak" });
      }
      if (line) {
        lineContent.push({
          type: "text",
          text: line,
        });
      }
    });

    return {
      type: "paragraph",
      content: lineContent,
    };
  });

  return {
    version: 1,
    type: "doc",
    content: content,
  };
}

/**
 * 在 Jira ticket 上新增評論
 * @param {string} ticketOrUrl - Jira ticket ID 或 URL
 * @param {string} comment - 評論內容（純文字）
 * @param {Object} options - 選項
 * @param {boolean} options.internal - 是否為內部評論（僅對 Jira Service Management 有效）
 * @returns {Object} 新增的評論資訊
 */
async function addJiraComment(ticketOrUrl, comment, options = {}) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  // 解析 ticket ID
  const ticket = parseJiraUrl(ticketOrUrl) || ticketOrUrl.toUpperCase();

  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
    throw new Error(`無效的 Jira ticket 格式: ${ticketOrUrl}`);
  }

  // 使用 Jira REST API 新增評論
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/comment`;

  // 準備請求體
  const requestBody = {
    body: textToADF(comment),
  };

  // 如果指定為內部評論（Jira Service Management）
  if (options.internal) {
    requestBody.properties = [
      {
        key: "sd.public.comment",
        value: {
          internal: true,
        },
      },
    ];
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Jira ticket: ${ticket}`);
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
      } else if (response.status === 400) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `評論格式錯誤: ${
            errorData.errorMessages?.join(", ") || response.statusText
          }`
        );
      } else {
        throw new Error(
          `新增評論失敗: ${response.status} ${response.statusText}`
        );
      }
    }

    const data = await response.json();

    return {
      success: true,
      ticket,
      ticketUrl: `${baseUrl}/browse/${ticket}`,
      commentId: data.id,
      commentUrl: `${baseUrl}/browse/${ticket}?focusedCommentId=${data.id}`,
      author: data.author?.displayName || "未知",
      created: data.created,
      message: `已成功在 ${ticket} 新增評論`,
    };
  } catch (error) {
    if (error.message.includes("Jira API Token")) {
      throw error;
    }
    throw new Error(`新增 Jira 評論失敗: ${error.message}`);
  }
}

// 解析命令列參數
function parseArgs(args) {
  const result = {
    ticket: null,
    comment: null,
    internal: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--internal" || arg === "-i") {
      result.internal = true;
    } else if (arg.startsWith("--comment=")) {
      result.comment = arg.substring("--comment=".length);
    } else if (arg.startsWith("--ticket=")) {
      result.ticket = arg.substring("--ticket=".length);
    } else if (arg === "--comment" || arg === "-c") {
      result.comment = args[++i];
    } else if (arg === "--ticket" || arg === "-t") {
      result.ticket = args[++i];
    } else if (!result.ticket) {
      result.ticket = arg;
    } else if (!result.comment) {
      result.comment = arg;
    }
  }

  return result;
}

// 顯示使用說明
function showHelp() {
  console.log(`
📝 Jira 留言工具

使用方法:
  node add-jira-comment.mjs <ticket> <comment>
  node add-jira-comment.mjs --ticket=<ticket> --comment=<comment>

參數:
  <ticket>              Jira ticket ID 或 URL（如 FE-1234）
  <comment>             評論內容

選項:
  -t, --ticket=<value>  指定 Jira ticket
  -c, --comment=<value> 指定評論內容
  -i, --internal        設為內部評論（僅 Jira Service Management 有效）
  -h, --help            顯示此說明

支援格式:
  - ✅ 多行純文字（段落 + 換行）
  - ✅ Markdown pipe table（例如 | a | b | / |---|---|），會轉成 Jira 表格
  - ❌ 其他 Markdown（如標題、清單、code block）目前仍以純文字呈現

範例:
  # 基本用法
  node add-jira-comment.mjs FE-1234 "這是一則評論"

  # 使用具名參數
  node add-jira-comment.mjs --ticket=FE-1234 --comment="這是一則評論"

  # 使用 URL
  node add-jira-comment.mjs "https://innotech.atlassian.net/browse/FE-1234" "已完成修改"

  # 多行評論
  node add-jira-comment.mjs FE-1234 "第一行
第二行
第三行"

  # 內部評論（Jira Service Management）
  node add-jira-comment.mjs FE-1234 "內部備註" --internal

輸出:
  成功時輸出 JSON 格式的結果，包含:
  - success: 是否成功
  - ticket: Ticket ID
  - ticketUrl: Ticket URL
  - commentId: 評論 ID
  - commentUrl: 評論直連 URL
  - author: 評論作者
  - created: 建立時間
  - message: 結果訊息
`);
}

// 主函數
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!args.ticket) {
    console.error("❌ 請提供 Jira ticket ID 或 URL");
    console.error("\n使用 --help 查看完整說明");
    process.exit(1);
  }

  if (!args.comment) {
    console.error("❌ 請提供評論內容");
    console.error("\n使用 --help 查看完整說明");
    process.exit(1);
  }

  try {
    const result = await addJiraComment(args.ticket, args.comment, {
      internal: args.internal,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

// 導出函數供其他模組使用
export { addJiraComment, textToADF, parseJiraUrl };

main();

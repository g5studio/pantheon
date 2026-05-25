#!/usr/bin/env node

/**
 * 新增 Jira ticket 留言
 * 使用 Jira API token 透過 API 在 ticket 上新增評論
 *
 * 流程圖支援：
 * - 使用 --render-flowchart 啟用
 * - 留言中的 ```mermaid ... ``` 區塊會渲染為 Jira 內嵌圖片（mermaid.ink + ADF external media）
 */

import { readFileSync } from "fs";
import { getJiraConfig } from "../utilities/env-loader.mjs";
import { appendAgentSignature } from "../utilities/agent-signature.mjs";
import {
  hasMermaidBlocks,
  renderMermaidToAdfNodes,
  splitCommentSegments,
} from "./mermaid-flowchart.mjs";

// 從 Jira URL 解析 ticket ID
function parseJiraUrl(url) {
  if (!url.includes("/")) {
    return url.toUpperCase();
  }

  const match = url.match(/\/browse\/([A-Z0-9]+-\d+)/);
  if (match) {
    return match[1];
  }

  const ticketMatch = url.match(/([A-Z0-9]+-\d+)/);
  if (ticketMatch) {
    return ticketMatch[1];
  }

  return null;
}

function normalizePipeRowCells(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed.includes("|")) return null;

  const parts = trimmed.split("|").map((s) => s.trim());
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

  if (lines.length < 2) return null;

  const headerCells = normalizePipeRowCells(lines[0]);
  if (!headerCells) return null;

  if (!isMarkdownTableSeparatorLine(lines[1], headerCells.length)) return null;

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
    content: [headerRow, ...rows],
  };
}

function paragraphTextToAdfNode(paragraph) {
  const tableNode = markdownPipeTableToADF(paragraph);
  if (tableNode) {
    return tableNode;
  }

  const trimmedParagraph = (paragraph ?? "").trim();
  if (!trimmedParagraph) {
    return null;
  }

  const lines = trimmedParagraph.split(/\n/);

  if (lines.length === 1) {
    return {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: trimmedParagraph,
        },
      ],
    };
  }

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
}

function buildTextSegmentAdfNodes(text) {
  const paragraphs = (text ?? "").split(/\n\n+/);
  const nodes = [];

  paragraphs.forEach((paragraph) => {
    const node = paragraphTextToAdfNode(paragraph);
    if (node) {
      nodes.push(node);
    }
  });

  return nodes;
}

/**
 * 將純文字轉換為 ADF content nodes
 * @param {string} text
 * @returns {Object[]}
 */
function convertPlainTextToAdfNodes(text) {
  return buildTextSegmentAdfNodes(text);
}

/**
 * 將留言轉換為 ADF 文件
 * @param {string} text
 * @param {Object} options
 * @param {boolean} [options.renderFlowchart=false]
 * @returns {Promise<{ doc: Object, flowcharts: Object[] }>}
 */
async function buildCommentAdf(text, options = {}) {
  const renderFlowchart = Boolean(options.renderFlowchart);

  if (!renderFlowchart) {
    return {
      doc: {
        version: 1,
        type: "doc",
        content: convertPlainTextToAdfNodes(text),
      },
      flowcharts: [],
    };
  }

  const segments = splitCommentSegments(text);
  const content = [];
  const flowcharts = [];
  let flowchartIndex = 0;

  for (const segment of segments) {
    if (segment.type === "text") {
      content.push(...buildTextSegmentAdfNodes(segment.content));
      continue;
    }

    flowchartIndex += 1;
    const rendered = await renderMermaidToAdfNodes(
      segment.content,
      flowchartIndex
    );

    content.push(...rendered.nodes);
    flowcharts.push({
      index: flowchartIndex,
      imageUrl: rendered.imageUrl,
      fallback: rendered.fallback,
      warning: rendered.warning || null,
    });
  }

  return {
    doc: {
      version: 1,
      type: "doc",
      content,
    },
    flowcharts,
  };
}

/**
 * 將純文字轉換為 ADF (Atlassian Document Format) 格式
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Object>|Object}
 */
async function textToADF(text, options = {}) {
  const { doc } = await buildCommentAdf(text, options);
  return doc;
}

/**
 * 在 Jira ticket 上新增評論
 * @param {string} ticketOrUrl
 * @param {string} comment
 * @param {Object} options
 * @param {boolean} [options.internal=false]
 * @param {boolean} [options.renderFlowchart=false]
 * @returns {Promise<Object>}
 */
async function addJiraComment(ticketOrUrl, comment, options = {}) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const ticket = parseJiraUrl(ticketOrUrl) || ticketOrUrl.toUpperCase();

  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
    throw new Error(`無效的 Jira ticket 格式: ${ticketOrUrl}`);
  }

  if (options.renderFlowchart && !hasMermaidBlocks(comment)) {
    throw new Error(
      "已啟用 --render-flowchart，但留言內容未找到 ```mermaid ... ``` 區塊"
    );
  }

  const signedComment = appendAgentSignature(comment);
  const { doc, flowcharts } = await buildCommentAdf(signedComment, options);

  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/comment`;
  const requestBody = {
    body: doc,
  };

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
      renderFlowchart: Boolean(options.renderFlowchart),
      flowcharts,
      message: `已成功在 ${ticket} 新增評論`,
    };
  } catch (error) {
    if (error.message.includes("Jira API Token")) {
      throw error;
    }
    throw new Error(`新增 Jira 評論失敗: ${error.message}`);
  }
}

function readCommentFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function parseArgs(args) {
  const result = {
    ticket: null,
    comment: null,
    commentFile: null,
    internal: false,
    renderFlowchart: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--internal" || arg === "-i") {
      result.internal = true;
    } else if (arg === "--render-flowchart" || arg === "--flowchart") {
      result.renderFlowchart = true;
    } else if (arg.startsWith("--comment-file=")) {
      result.commentFile = arg.substring("--comment-file=".length);
    } else if (arg === "--comment-file" || arg === "-f") {
      result.commentFile = args[++i];
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

function showHelp() {
  console.log(`
📝 Jira 留言工具

使用方法:
  node add-jira-comment.mjs <ticket> <comment>
  node add-jira-comment.mjs --ticket=<ticket> --comment=<comment>
  node add-jira-comment.mjs --ticket=<ticket> --comment-file=<path> --render-flowchart

參數:
  <ticket>              Jira ticket ID 或 URL（如 FE-1234）
  <comment>             評論內容

選項:
  -t, --ticket=<value>       指定 Jira ticket
  -c, --comment=<value>      指定評論內容
  -f, --comment-file=<path>  從檔案讀取評論內容（適合含 Mermaid 流程圖的長留言）
  --render-flowchart         將留言中的 \`\`\`mermaid ... \`\`\` 渲染為 Jira 內嵌流程圖
  --flowchart                --render-flowchart 別名
  -i, --internal             設為內部評論（僅 Jira Service Management 有效）
  -h, --help                 顯示此說明

支援格式:
  - ✅ 多行純文字（段落 + 換行）
  - ✅ Markdown pipe table（例如 | a | b | / |---|---|），會轉成 Jira 表格
  - ✅ \`\`\`mermaid ... \`\`\`（需搭配 --render-flowchart）→ Jira 內嵌流程圖
  - ⚠️ 流程圖渲染依賴 mermaid.ink 公開服務；失敗時 fallback 為 mermaid codeBlock

Agent 使用建議:
  當用戶要求將資料流／流程圖留言到 Jira 時，請使用 --render-flowchart，
  並在 comment 內保留 \`\`\`mermaid 區塊與配套 Markdown 表格。

範例:
  # 基本用法
  node add-jira-comment.mjs FE-1234 "這是一則評論"

  # 留言含流程圖（從檔案讀取）
  node add-jira-comment.mjs --ticket=FE-8250 --comment-file=./comment.md --render-flowchart

  # 留言含流程圖（inline）
  node add-jira-comment.mjs FE-8250 "調整摘要

| 項目 | 說明 |
|------|------|
| 規則 | chat-report-guideline |

\`\`\`mermaid
flowchart TD
  A[輸入] --> B[處理] --> C[輸出]
\`\`\`" --render-flowchart

輸出:
  成功時輸出 JSON，包含 ticket、commentUrl、renderFlowchart、flowcharts 等欄位
`);
}

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

  let comment = args.comment;
  if (args.commentFile) {
    comment = readCommentFile(args.commentFile);
  }

  if (!comment) {
    console.error("❌ 請提供評論內容（--comment 或 --comment-file）");
    console.error("\n使用 --help 查看完整說明");
    process.exit(1);
  }

  try {
    const result = await addJiraComment(args.ticket, comment, {
      internal: args.internal,
      renderFlowchart: args.renderFlowchart,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

export {
  addJiraComment,
  buildCommentAdf,
  textToADF,
  parseJiraUrl,
  convertPlainTextToAdfNodes,
};

main();

#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module add-jira-comment-script
 * @purpose 使用 Jira API 在指定 ticket 新增評論，並支援內嵌 Mermaid 流程圖渲染（以 ADF 格式輸出）
 * @external https://innotech.atlassian.net/browse/FE-8310
 * @external https://innotech.atlassian.net/browse/FE-8250
 * @external https://innotech.atlassian.net/browse/FE-8004
 * @external https://innotech.atlassian.net/browse/FE-7910
 * @external https://innotech.atlassian.net/browse/FE-7892
 */

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */

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
import { hasMermaidBlocks } from "./mermaid-flowchart.mjs";
import {
  JIRA_CONTENT_OPERATIONS,
  prepareJiraContent,
  summarizeFormatCheck,
} from "./jira-content-formatter.mjs";
import {
  buildRichTextAdf,
  buildTextSegmentAdfNodes,
} from "./jira-adf-builder.mjs";

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

const buildCommentAdf = buildRichTextAdf;

async function textToADF(text, options = {}) {
  const { doc } = await buildRichTextAdf(text, options);
  return doc;
}

function convertPlainTextToAdfNodes(text) {
  return buildTextSegmentAdfNodes(text);
}

/**
 * 在 Jira ticket 上新增評論
 * @description 組合並送出 Jira Comment ADF（含格式檢查結果與可選 mermaid 流程圖渲染）
 * @purpose add jira comment
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-8310
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

  const formatResult = await prepareJiraContent(
    comment,
    JIRA_CONTENT_OPERATIONS.COMMENT,
    {
      skipFormatCheck: options.skipFormatCheck,
      renderFlowchart: options.renderFlowchart,
      silent: options.silentFormatCheck,
    }
  );
  const normalizedComment = formatResult.normalizedContent;

  if (options.renderFlowchart && !hasMermaidBlocks(normalizedComment)) {
    throw new Error(
      "已啟用 --render-flowchart，但留言內容未找到 ```mermaid ... ``` 區塊"
    );
  }

  const signedComment = appendAgentSignature(normalizedComment);
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
      formatCheck: summarizeFormatCheck(formatResult),
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
    skipFormatCheck: false,
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
    } else if (arg === "--skip-format-check") {
      result.skipFormatCheck = true;
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
  --skip-format-check        略過 LLM 格式檢查（直接送出原始內容）
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
      skipFormatCheck: args.skipFormatCheck,
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

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13T17:52:53.540Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 只調整註解結構：補齊三區塊佈局；移除重複/不符合格式的聲明註解；確保 addJiraComment 宣告級 @external 僅使用來源單號並符合 Jira browse URL 格式；不改動任何程式邏輯。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:21:24.325Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 修正註解為三區塊格式；移除重複/不符合規則的 addJiraComment JSDoc 與不符合版型內容；整理 llm 分析紀錄為單一底部區塊，並確保 @external 使用完整 Jira browse URL 與宣告單號關聯規則。
 */

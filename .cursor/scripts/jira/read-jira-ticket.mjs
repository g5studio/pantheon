#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/jira/read-jira-ticket.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * 檔案用途區塊
 * @module read-jira-ticket
 * @purpose 透過 Jira REST API 讀取指定 ticket（ticket ID 或 browse URL）的摘要、欄位與評論，並將結果輸出為 JSON。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";

// 從 Jira URL 解析 ticket ID
/**
 * 宣告內容用途說明與單號關聯
 * @description 解析輸入的 Jira URL 或 ticket ID，取得標準 ticket Key（如 FE-1234）。
 * @purpose 供後續 Jira API 查詢使用。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
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

  // 嘗試直接匹配 ticket 格
  const ticketMatch = url.match(/([A-Z0-9]+-\d+)/);
  if (ticketMatch) {
    return ticketMatch[1];
  }

  return null;
}

// 提取 ADF 格式的文本內容
/**
 * 宣告內容用途說明與單號關聯
 * @description 將 Jira 回傳的 ADF（Atlassian Document Format）內容遞迴轉換為純文字字串。
 * @purpose 用於 description 與 comments 的 body 文字抽取。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
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

// 讀取 Jira ticket
/**
 * 宣告內容用途說明與單號關聯
 * @description 使用 Jira API 取得指定 issue 的欄位與評論，並整理輸出（含 summary、狀態、指派、優先度、descriptionText、commentsList 與 raw）。
 * @purpose 供 CLI 執行並序列化 JSON 給下游使用。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
async function readJiraTicket(ticketOrUrl) {
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

  // 使用 Jira REST API 獲取 ticket 信息
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}?expand=renderedFields,comments`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Jira ticket: ${ticket}`);
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
      } else {
        throw new Error(
          `獲取 Jira ticket 失敗: ${response.status} ${response.statusText}`
        );
      }
    }

    const data = await response.json();
    const fields = data.fields || {};

    // 提取基本信息
    const summary = fields.summary || "無標題";
    const description = fields.description || "";
    const issueType = fields.issuetype?.name || "未知類型";
    const status = fields.status?.name || "未知狀態";
    const assignee = fields.assignee?.displayName || "未分配";
    const priority = fields.priority?.name || "未設置";
    const comments = fields.comment || {};

    // 提取描述文本
    const descriptionText =
      typeof description === "string"
        ? description
        : extractTextFromADF(description);

    // 提取評論文本
    const commentsList = (comments.comments || []).map((comment) => ({
      author: comment.author?.displayName || "未知",
      created: comment.created,
      body: extractTextFromADF(comment.body),
    }));

    return {
      ticket,
      url: `${baseUrl}/browse/${ticket}`,
      summary,
      issueType,
      status,
      assignee,
      priority,
      description: descriptionText,
      comments: commentsList,
      raw: data, // 保留原始數據以便進一步處理
    };
  } catch (error) {
    if (error.message.includes("Jira API Token")) {
      throw error;
    }
    throw new Error(`讀取 Jira ticket 失敗: ${error.message}`);
  }
}

// 主函數
/**
 * 宣告內容用途說明與單號關聯
 * @description CLI 入口：讀取命令列參數（ticket ID 或 URL），呼叫 readJiraTicket 並印出 JSON；必要時輸出使用說明或錯誤。
 * @purpose 作為 script 的直接執行入口。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
async function main() {
  const ticketOrUrl = process.argv[2];

  if (!ticketOrUrl) {
    console.error("❌ 請提供 Jira ticket ID 或 URL");
    console.error("\n使用方法:");
    console.error("  node read-jira-ticket.mjs <ticket-id-or-url>");
    console.error("\n範例:");
    console.error('  node read-jira-ticket.mjs "FE-1234"');
    console.error(
      '  node read-jira-ticket.mjs "https://innotech.atlassian.net/browse/FE-1234"'
    );
    process.exit(1);
  }

  try {
    const result = await readJiraTicket(ticketOrUrl);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactor-engine
 * @llm-review-note 已將檔案頂部/宣告/底部三段式註解補齊，並依輸入中的 declarationOrigins 對應 FE-7893 用於宣告區 @external。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:24:01.504Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 調整並補齊註解：將宣告區/檔案用途區塊的 @external 皆改為完整 Jira browse URL 格式，並確保宣告級註解使用符合規格之三段式標題與欄位不涉及執行邏輯。
 */

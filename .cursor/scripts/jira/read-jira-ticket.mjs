#!/usr/bin/env node

/**
 * 讀取 Jira ticket 內容
 * 使用 Jira API token 透過 API 訪問 ticket 信息
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

// 讀取 Jira ticket
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

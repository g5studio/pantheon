#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module read-jira-ticket
 * @purpose 讀取 Jira ticket 並以 Agent-first 格式輸出（支援截斷、section、bundle）
 * @external https://innotech.atlassian.net/browse/FE-8389
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";
import {
  applyBundleDefaults,
  buildMeta,
  commentLooksLikeRdNote,
  isSystemComment,
  logProgress,
  parseExternalOutputArgs,
  pickJiraSections,
  sliceCommentsByLimit,
  truncateText,
  writeScriptError,
  writeScriptResult,
} from "../utilities/external-output.mjs";

const JIRA_FIELD_WHITELIST = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "components",
  "fixVersions",
  "duedate",
  "comment",
  "issuelinks",
  "subtasks",
  "created",
  "updated",
].join(",");

/**
 * @description 解析 Jira URL 或 ticket key
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function parseJiraUrl(url) {
  if (!url.includes("/")) {
    return url.toUpperCase();
  }

  const match = url.match(/\/browse\/([A-Z0-9]+-\d+)/);
  if (match) return match[1];

  const ticketMatch = url.match(/([A-Z0-9]+-\d+)/);
  if (ticketMatch) return ticketMatch[1];

  return null;
}

/**
 * @description ADF 轉純文字
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function extractTextFromADF(content) {
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

function mapIssueLinks(issuelinks = []) {
  return issuelinks
    .map((link) => {
      const inward = link.inwardIssue;
      const outward = link.outwardIssue;
      const linked = inward || outward;
      if (!linked) return null;

      return {
        type: link.type?.name || "relates to",
        direction: inward ? "inward" : "outward",
        ticket: linked.key,
        summary: linked.fields?.summary || "",
      };
    })
    .filter(Boolean);
}

function mapSubtasks(subtasks = []) {
  return subtasks
    .map((item) => ({
      ticket: item.key,
      summary: item.fields?.summary || "",
      status: item.fields?.status?.name || "",
    }))
    .filter((item) => item.ticket);
}

function filterComments(comments, options) {
  let list = [...comments];

  if (options.commentsSince) {
    const since = new Date(options.commentsSince).getTime();
    list = list.filter((comment) => new Date(comment.created).getTime() >= since);
  }

  if (options.skipSystemComments) {
    list = list.filter((comment) => !isSystemComment(comment));
  }

  list.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  const totalCount = list.length;
  const { comments: sliced, hasMoreComments } = sliceCommentsByLimit(
    list,
    options.commentsLimit,
  );
  const hasRdNotes = list.some((comment) => commentLooksLikeRdNote(comment.body));

  return {
    comments: sliced,
    commentCount: totalCount,
    commentsReturned: sliced.length,
    hasMoreComments: totalCount > sliced.length,
    hasRdNotes,
  };
}

/**
 * @description 讀取 Jira ticket 並組裝 agent payload
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export async function readJiraTicket(ticketOrUrl, userOptions = {}) {
  const options = applyBundleDefaults({
    maxChars: 8000,
    commentsLimit: 20,
    skipSystemComments: false,
    includeRaw: false,
    ...userOptions,
  });

  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const ticket = parseJiraUrl(ticketOrUrl) || String(ticketOrUrl).toUpperCase();

  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
    throw new Error(`無效的 Jira ticket 格式: ${ticketOrUrl}`);
  }

  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}?fields=${JIRA_FIELD_WHITELIST}`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`找不到 Jira ticket: ${ticket}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
    }
    throw new Error(`獲取 Jira ticket 失敗: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const fields = data.fields || {};

  const descriptionRaw =
    typeof fields.description === "string"
      ? fields.description
      : extractTextFromADF(fields.description);

  const descriptionResult = truncateText(descriptionRaw, options.maxChars);

  const commentsRaw = (fields.comment?.comments || []).map((comment) => ({
    author: comment.author?.displayName || "未知",
    created: comment.created,
    body: extractTextFromADF(comment.body),
  }));

  const commentResult = filterComments(commentsRaw, options);

  const payload = {
    source: "jira",
    ticket,
    url: `${baseUrl}/browse/${ticket}`,
    summary: fields.summary || "無標題",
    issueType: fields.issuetype?.name || "未知類型",
    status: fields.status?.name || "未知狀態",
    assignee: fields.assignee?.displayName || "未分配",
    reporter: fields.reporter?.displayName || null,
    priority: fields.priority?.name || "未設置",
    labels: fields.labels || [],
    components: (fields.components || []).map((item) => item.name),
    fixVersions: (fields.fixVersions || []).map((item) => item.name),
    dueDate: fields.duedate || null,
    created: fields.created || null,
    updated: fields.updated || null,
    description: descriptionResult.text,
    comments: commentResult.comments,
    links: mapIssueLinks(fields.issuelinks || []),
    subtasks: mapSubtasks(fields.subtasks || []),
    meta: buildMeta({
      truncated: descriptionResult.truncated || commentResult.hasMoreComments,
      descriptionTotalChars: descriptionResult.totalChars,
      descriptionReturnedChars: descriptionResult.returnedChars,
      commentCount: commentResult.commentCount,
      commentsReturned: commentResult.commentsReturned,
      hasMoreComments: commentResult.hasMoreComments,
      hasMoreDescription: descriptionResult.truncated,
      hasRdNotes: commentResult.hasRdNotes,
      bundleApplied: options.bundleApplied || null,
    }),
  };

  if (options.includeRaw) {
    payload.raw = data;
  }

  return pickJiraSections(payload, options.section);
}

function showHelp() {
  logProgress(`
Jira Ticket 讀取工具（Agent-first Output）

用法:
  node read-jira-ticket.mjs FE-1234
  node read-jira-ticket.mjs --ticket=FE-1234 --format=agent
  node read-jira-ticket.mjs FE-1234 --section=comments --comments-limit=5
  node read-jira-ticket.mjs FE-1234 --bundle=start-task

參數:
  --ticket=<ID>              Ticket ID 或 URL（也可 positional）
  --format=agent|human|json  輸出格式（預設：非 TTY=agent，TTY=human）
  --include-raw              包含完整 Jira API payload
  --max-chars=<n>            description 上限（預設 8000）
  --comments-limit=<n|all>   comment 數量上限（預設 20；0=不取；all=不設限）
  --comments-since=<ISO>     只取此時間之後的 comments
  --skip-system-comments     過濾 bot/系統留言
  --section=summary|description|comments|links|metadata|all
  --bundle=start-task|cr|rd-context（start-task/rd-context 留言不設限；cr 不含留言）
  --help                     顯示說明

輸出欄位:
  subtasks[]                 子任務列表（ticket, summary, status）；CR 多 ticket 流程優先使用
  links[]                    關聯單（含部分子任務關係）；subtasks 為空時可備援
  meta.hints.nextSections    若資料被截斷，提示需展開的 section
`);
}

async function main() {
  const args = parseExternalOutputArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  const ticketOrUrl =
    args.ticket || args.positional[0] || args.positional.find((item) => /[A-Z0-9]+-\d+/.test(item));

  if (!ticketOrUrl) {
    writeScriptError("請提供 Jira ticket ID 或 URL", "MISSING_TICKET");
  }

  try {
    logProgress(`Reading Jira ticket ${ticketOrUrl}...`);
    const result = await readJiraTicket(ticketOrUrl, args);
    writeScriptResult(result, args.resolvedFormat);
  } catch (error) {
    writeScriptError(error.message, "READ_JIRA_FAILED");
  }
}

main();

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-14T12:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note FE-8389 Phase 1/2：移除預設 raw、fields 白名單、截斷/meta、format/section/bundle。
 */

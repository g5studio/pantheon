#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module read-jira-ticket
 * @purpose 讀取 Jira ticket 並以 Agent-first 格式輸出（支援截斷、section、bundle、可擴充 fields）
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

/** @description 預設 Jira fields 白名單（含 prometheus start-task / multi-task 所需欄位） */
export const JIRA_DEFAULT_FIELDS = [
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
  "parent",
  "created",
  "updated",
  "timetracking",
  "timeoriginalestimate",
  "timespent",
  "aggregatetimeoriginalestimate",
];

const FIRST_CLASS_FIELD_KEYS = new Set([
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
  "parent",
  "created",
  "updated",
  "timetracking",
  "timeoriginalestimate",
  "timespent",
  "aggregatetimeoriginalestimate",
]);

/**
 * @description 解析逗號分隔的 Jira field id 清單
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function parseCommaFieldList(value) {
  if (value == null || value === true || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @description 合併預設白名單、--fields 覆寫與 --extra-fields 追加
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function resolveJiraApiFields(options = {}) {
  const extraFields = parseCommaFieldList(options.extra_fields ?? options.extraFields);
  const fieldsOverride = options.fields ?? null;

  if (fieldsOverride === "all" || fieldsOverride === "*") {
    return {
      apiFieldsQuery: null,
      requestedFields: null,
      mode: "all",
      extraFields,
    };
  }

  if (fieldsOverride && String(fieldsOverride).trim()) {
    const overrideList = parseCommaFieldList(fieldsOverride);
    return {
      apiFieldsQuery: overrideList.join(","),
      requestedFields: overrideList,
      mode: "override",
      extraFields: [],
    };
  }

  const merged = [...new Set([...JIRA_DEFAULT_FIELDS, ...extraFields])];
  return {
    apiFieldsQuery: merged.join(","),
    requestedFields: merged,
    mode: "default",
    extraFields,
  };
}

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

/**
 * @description 精簡 Jira field 值供 agent payload 使用
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function simplifyJiraFieldValue(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const simplified = value
      .map((item) => simplifyJiraFieldValue(item))
      .filter((item) => item != null && item !== "");
    return simplified.length ? simplified : null;
  }
  if (value.key && (value.name || value.fields?.summary)) {
    return {
      key: value.key,
      name: value.name || value.fields?.summary || null,
      summary: value.fields?.summary || value.name || null,
    };
  }
  if (value.displayName) return value.displayName;
  if (value.name && typeof value.name === "string") return value.name;
  if (value.content) {
    const text = extractTextFromADF(value);
    return text || null;
  }
  return value;
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

function mapParent(parent) {
  if (!parent?.key) return null;
  return {
    ticket: parent.key,
    summary: parent.fields?.summary || "",
    issueType: parent.fields?.issuetype?.name || null,
  };
}

function mapTimeTracking(fields) {
  const tt = fields.timetracking || {};
  const originalEstimate = tt.originalEstimate ?? null;
  const remainingEstimate = tt.remainingEstimate ?? null;
  const timeSpent = tt.timeSpent ?? null;
  const originalEstimateSeconds = fields.timeoriginalestimate ?? null;
  const aggregateOriginalEstimateSeconds = fields.aggregatetimeoriginalestimate ?? null;

  if (
    !originalEstimate &&
    !remainingEstimate &&
    !timeSpent &&
    originalEstimateSeconds == null &&
    aggregateOriginalEstimateSeconds == null
  ) {
    return null;
  }

  return {
    originalEstimate,
    remainingEstimate,
    timeSpent,
    originalEstimateSeconds,
    aggregateOriginalEstimateSeconds,
  };
}

function mapExtraFieldValues(fields, extraFieldKeys = []) {
  const result = {};
  for (const key of extraFieldKeys) {
    if (fields[key] === undefined) continue;
    const simplified = simplifyJiraFieldValue(fields[key]);
    if (simplified != null && simplified !== "") {
      result[key] = simplified;
    }
  }
  return Object.keys(result).length ? result : null;
}

function mapUnmappedFieldValues(fields, mode) {
  if (mode !== "all") return null;

  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FIRST_CLASS_FIELD_KEYS.has(key)) continue;
    const simplified = simplifyJiraFieldValue(value);
    if (simplified != null && simplified !== "") {
      result[key] = simplified;
    }
  }
  return Object.keys(result).length ? result : null;
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
  const { comments: sliced } = sliceCommentsByLimit(list, options.commentsLimit);
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
    skipSystemComments: false,
    includeRaw: false,
    ...userOptions,
  });

  if (!options.maxCharsExplicit) {
    options.maxChars = Infinity;
  }
  if (!options.commentsLimitExplicit) {
    options.commentsLimit = Infinity;
  }

  const fieldQuery = resolveJiraApiFields(options);
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const ticket = parseJiraUrl(ticketOrUrl) || String(ticketOrUrl).toUpperCase();

  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
    throw new Error(`無效的 Jira ticket 格式: ${ticketOrUrl}`);
  }

  const fieldsParam = fieldQuery.apiFieldsQuery
    ? `?fields=${encodeURIComponent(fieldQuery.apiFieldsQuery)}`
    : "";
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}${fieldsParam}`;

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
  const issueTypeName = fields.issuetype?.name || "未知類型";

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

  const extraFromRequest = mapExtraFieldValues(fields, fieldQuery.extraFields);
  const extraFromAll = mapUnmappedFieldValues(fields, fieldQuery.mode);
  const extraFields =
    extraFromRequest && extraFromAll
      ? { ...extraFromAll, ...extraFromRequest }
      : extraFromRequest || extraFromAll;

  const payload = {
    source: "jira",
    ticket,
    url: `${baseUrl}/browse/${ticket}`,
    summary: fields.summary || "無標題",
    issueType: issueTypeName,
    isSubTask: issueTypeName.toLowerCase() === "sub-task",
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
    parent: mapParent(fields.parent),
    timeTracking: mapTimeTracking(fields),
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
      fieldsMode: fieldQuery.mode,
      requestedFields: fieldQuery.requestedFields,
      extraFieldsRequested: fieldQuery.extraFields?.length ? fieldQuery.extraFields : null,
      hints: {
        ...(fieldQuery.mode === "all"
          ? { fieldsAll: true, note: "Used --fields=all; payload may be large. Prefer --extra-fields for targeted queries." }
          : {}),
        ...(fieldQuery.extraFields?.length
          ? { extraFieldsAvailable: true }
          : {}),
      },
    }),
  };

  if (extraFields) {
    payload.extraFields = extraFields;
  }

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
  node read-jira-ticket.mjs FE-1234 --extra-fields=customfield_10028,customfield_10020
  node read-jira-ticket.mjs FE-1234 --fields=summary,description,parent --section=metadata

參數:
  --ticket=<ID>              Ticket ID 或 URL（也可 positional）
  --format=agent|human|json  輸出格式（預設：非 TTY=agent，TTY=human）
  --include-raw              包含 Jira API payload（仍受 --fields 影響）
  --fields=<list|all>        覆寫 API fields（逗號分隔）；all/* 不設 fields 過濾
  --extra-fields=<list>      追加 Jira fields（逗號分隔 customfield 等），輸出至 extraFields
  --max-chars=<n>            description 上限（預設不截斷；指定後才截斷）
  --comments-limit=<n|all>   comment 數量上限（預設不截斷；0=不取；all=不設限）
  --comments-since=<ISO>     只取此時間之後的 comments
  --skip-system-comments     過濾 bot/系統留言
  --section=summary|description|comments|links|metadata|extra|all
  --bundle=start-task|cr|rd-context（cr 僅 metadata 且不含留言）
  --help                     顯示說明

輸出欄位:
  parent                     父任務（Sub-task 偵測用；含 ticket, summary, issueType）
  isSubTask                  是否為 Sub-task
  timeTracking               工時（originalEstimate、remainingEstimate 等）
  extraFields                --extra-fields 或 --fields=all 時的非標準欄位
  subtasks[]                 子任務列表（ticket, summary, status）
  links[]                    關聯單（subtasks 為空時可備援）
  meta.fieldsMode            default | override | all
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
 * @llm-review-submitted-at 2026-06-30T12:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note 預設不截斷 description/comments；保留 --max-chars/--comments-limit 供按需限制。
 */

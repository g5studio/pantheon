#!/usr/bin/env node

/**
 * Jira 開單腳本
 *
 * 功能：
 * 1. 在指定專案建立 Jira issue
 * 2. 支援 summary、description、issue type、epic link
 * 3. 自動讀取 create metadata，避免硬編碼 issue type / field key
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";
import {
  JIRA_CONTENT_OPERATIONS,
  prepareJiraContent,
  summarizeFormatCheck,
} from "./jira-content-formatter.mjs";
import { buildAdfDocFromText } from "./jira-adf-builder.mjs";

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

function createApiConfig() {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  return { auth, baseUrl };
}

async function requestJira(path, options = {}) {
  const { auth, baseUrl } = createApiConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessages = [
      ...(errorData.errorMessages || []),
      ...Object.entries(errorData.errors || {}).map(
        ([field, message]) => `${field}: ${message}`
      ),
    ].filter(Boolean);

    if (response.status === 404) {
      throw new Error("找不到對應的 Jira 資源");
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
    }

    throw new Error(
      errorMessages.length > 0
        ? errorMessages.join(", ")
        : `${response.status} ${response.statusText}`
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function searchUsers(query) {
  return requestJira(
    `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=10`
  );
}

async function getCreateIssueTypes(projectKey) {
  return requestJira(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
}

async function getCreateFieldMeta(projectKey, issueTypeId) {
  const data = await requestJira(
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(
      projectKey
    )}&issuetypeIds=${encodeURIComponent(
      issueTypeId
    )}&expand=projects.issuetypes.fields`
  );

  const issueTypeMeta = data.projects?.[0]?.issuetypes?.[0];
  if (!issueTypeMeta?.fields) {
    throw new Error(
      `無法取得 ${projectKey} issue type ${issueTypeId} 的 create metadata`
    );
  }

  return { fields: issueTypeMeta.fields };
}

async function resolveIssueType(projectKey, issueTypeName) {
  const data = await getCreateIssueTypes(projectKey);
  const issueTypes = data.issueTypes || [];
  const targetName = issueTypeName.toLowerCase();

  const matched = issueTypes.find(
    (issueType) => issueType.name.toLowerCase() === targetName
  );

  if (!matched) {
    throw new Error(
      `找不到 issue type "${issueTypeName}"。可用類型: ${
        issueTypes.map((issueType) => issueType.name).join(", ") || "無"
      }`
    );
  }

  return matched;
}

function findFieldKey(fieldMeta, predicate) {
  return (
    Object.entries(fieldMeta).find(([, meta]) => predicate(meta))?.[0] || null
  );
}

function findFieldKeyBySystem(fieldMeta, system) {
  return findFieldKey(fieldMeta, (meta) => meta.schema?.system === system);
}

function findFieldKeyByCustom(fieldMeta, customType) {
  return findFieldKey(
    fieldMeta,
    (meta) => meta.schema?.custom === customType
  );
}

function normalizeCliMultilineText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function parseArgs(args) {
  const result = {
    project: null,
    summary: null,
    description: null,
    descriptionFile: null,
    issueType: "Request",
    epic: null,
    parent: null,
    linkType: "拆分为",
    assignee: null,
    priority: null,
    labels: null,
    components: null,
    skipFormatCheck: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg.startsWith("--project=")) {
      result.project = arg.split("=").slice(1).join("=");
    } else if (arg === "--project" || arg === "-p") {
      result.project = args[++i];
    } else if (arg.startsWith("--summary=")) {
      result.summary = arg.split("=").slice(1).join("=");
    } else if (arg === "--summary" || arg === "-s") {
      result.summary = args[++i];
    } else if (arg.startsWith("--description=")) {
      result.description = arg.split("=").slice(1).join("=");
    } else if (arg === "--description" || arg === "-d") {
      result.description = args[++i];
    } else if (arg.startsWith("--description-file=")) {
      result.descriptionFile = arg.split("=").slice(1).join("=");
    } else if (arg === "--description-file") {
      result.descriptionFile = args[++i];
    } else if (arg.startsWith("--issue-type=")) {
      result.issueType = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--epic=") || arg.startsWith("--epic-link=")) {
      result.epic = arg.split("=").slice(1).join("=");
    } else if (arg === "--epic" || arg === "--epic-link") {
      result.epic = args[++i];
    } else if (arg.startsWith("--parent=")) {
      result.parent = arg.split("=").slice(1).join("=");
    } else if (arg === "--parent") {
      result.parent = args[++i];
    } else if (arg.startsWith("--link-type=")) {
      result.linkType = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--assignee=")) {
      result.assignee = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--priority=")) {
      result.priority = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--labels=")) {
      result.labels = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--components=")) {
      result.components = arg.split("=").slice(1).join("=");
    } else if (arg === "--skip-format-check") {
      result.skipFormatCheck = true;
    }
  }

  if (typeof result.summary === "string") {
    result.summary = normalizeCliMultilineText(result.summary);
  }
  if (typeof result.description === "string") {
    result.description = normalizeCliMultilineText(result.description);
  }

  if (result.descriptionFile) {
    const filePath = result.descriptionFile;
    result.description = readFileSync(filePath, "utf-8");
  }

  return result;
}

function getEpicFieldKey(fieldMeta) {
  return (
    findFieldKeyByCustom(fieldMeta, "com.pyxis.greenhopper.jira:gh-epic-link") ||
    findFieldKey(fieldMeta, (meta) =>
      /epic\s*link|史诗链接/i.test(meta.name || "")
    )
  );
}

function getMissingRequiredFields(fieldMeta, fields) {
  const handledSystems = new Set([
    "project",
    "summary",
    "issuetype",
    "reporter",
  ]);

  return Object.entries(fieldMeta)
    .filter(([, meta]) => meta.required && !meta.hasDefaultValue)
    .filter(([fieldKey, meta]) => {
      const system = meta.schema?.system;
      if (system && handledSystems.has(system)) {
        return false;
      }

      return fields[fieldKey] === undefined;
    })
    .map(([, meta]) => meta.name || meta.schema?.system || "unknown");
}

async function getIssueLinkTypes() {
  const data = await requestJira("/rest/api/3/issueLinkType");
  return data.issueLinkTypes || [];
}

async function createIssueLink(sourceTicket, targetTicket, linkTypeName) {
  const linkTypes = await getIssueLinkTypes();
  const linkType = linkTypes.find(
    (type) =>
      type.name.toLowerCase() === linkTypeName.toLowerCase() ||
      type.inward.toLowerCase() === linkTypeName.toLowerCase() ||
      type.outward.toLowerCase() === linkTypeName.toLowerCase()
  );

  if (!linkType) {
    const availableTypes = linkTypes
      .map((type) => `"${type.name}" (${type.inward} / ${type.outward})`)
      .join(", ");
    throw new Error(
      `找不到 Link 類型 "${linkTypeName}"。可用類型: ${availableTypes}`
    );
  }

  const isInward = linkType.inward.toLowerCase() === linkTypeName.toLowerCase();

  await requestJira("/rest/api/3/issueLink", {
    method: "POST",
    body: JSON.stringify({
      type: { name: linkType.name },
      inwardIssue: { key: isInward ? sourceTicket : targetTicket },
      outwardIssue: { key: isInward ? targetTicket : sourceTicket },
    }),
  });

  return {
    type: linkType.name,
    direction: isInward ? "inward" : "outward",
    source: sourceTicket,
    target: targetTicket,
  };
}

function normalizeTicketKey(ticketOrUrl) {
  const ticket = parseJiraUrl(ticketOrUrl) || ticketOrUrl.toUpperCase();

  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
    throw new Error(`無效的 Jira ticket 格式: ${ticketOrUrl}`);
  }

  return ticket;
}

async function buildCreateFields(options, createMeta, issueType) {
  const fieldMeta = createMeta.fields || {};
  const formatChecks = {};

  const summaryFormat = await prepareJiraContent(
    options.summary,
    JIRA_CONTENT_OPERATIONS.SUMMARY,
    { skipFormatCheck: options.skipFormatCheck }
  );
  formatChecks.summary = summarizeFormatCheck(summaryFormat);

  const fields = {
    project: { key: options.project },
    summary: summaryFormat.normalizedContent,
    issuetype: { id: issueType.id },
  };

  const descriptionFieldKey = findFieldKeyBySystem(fieldMeta, "description");
  if (options.description && descriptionFieldKey) {
    const descriptionFormat = await prepareJiraContent(
      options.description,
      JIRA_CONTENT_OPERATIONS.DESCRIPTION,
      { skipFormatCheck: options.skipFormatCheck }
    );
    formatChecks.description = summarizeFormatCheck(descriptionFormat);
    fields.description = buildAdfDocFromText(
      descriptionFormat.normalizedContent
    );
  }

  const assigneeFieldKey = findFieldKeyBySystem(fieldMeta, "assignee");
  if (options.assignee && assigneeFieldKey) {
    const users = await searchUsers(options.assignee);
    if (!users.length) {
      throw new Error(`找不到用戶: ${options.assignee}`);
    }
    fields.assignee = { accountId: users[0].accountId };
  }

  const priorityFieldKey = findFieldKeyBySystem(fieldMeta, "priority");
  if (options.priority && priorityFieldKey) {
    fields.priority = { name: options.priority };
  }

  const labelsFieldKey = findFieldKeyBySystem(fieldMeta, "labels");
  if (options.labels && labelsFieldKey) {
    fields.labels = options.labels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
  }

  const componentsFieldKey = findFieldKeyBySystem(fieldMeta, "components");
  if (options.components && componentsFieldKey) {
    fields.components = options.components
      .split(",")
      .map((component) => component.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }

  const parentFieldKey = findFieldKeyBySystem(fieldMeta, "parent");
  const parentTarget = options.parent || options.epic;

  if (parentTarget) {
    const parentKey = normalizeTicketKey(parentTarget);

    if (issueType.subtask && !parentFieldKey) {
      throw new Error("Sub-task 需要 parent 欄位，但此 issue type 不支援 parent");
    }

    if (parentFieldKey) {
      fields.parent = { key: parentKey };
    }
  } else if (issueType.subtask) {
    throw new Error("建立 Sub-task 時必須指定 --parent=<父單 ticket>");
  }

  if (options.epic) {
    const epicKey = normalizeTicketKey(options.epic);
    const epicFieldKey = getEpicFieldKey(fieldMeta);

    if (epicFieldKey) {
      fields[epicFieldKey] = epicKey;
    }
  }

  const missingRequiredFields = getMissingRequiredFields(fieldMeta, fields);
  if (missingRequiredFields.length > 0) {
    throw new Error(
      `缺少必填欄位: ${missingRequiredFields.join(
        ", "
      )}。請擴充腳本或在 Jira create screen 設定預設值。`
    );
  }

  return {
    fields,
    parentFieldKey,
    epicFieldKey: options.epic ? getEpicFieldKey(fieldMeta) : null,
    formatChecks,
  };
}

async function createJiraTicket(options) {
  const issueType = await resolveIssueType(options.project, options.issueType);
  const createMeta = await getCreateFieldMeta(options.project, issueType.id);
  const { fields, parentFieldKey, epicFieldKey, formatChecks } =
    await buildCreateFields(options, createMeta, issueType);
  const created = await requestJira("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  const { baseUrl } = createApiConfig();
  const associationTarget = options.parent || options.epic;
  let issueLink = null;

  if (
    associationTarget &&
    !parentFieldKey &&
    !epicFieldKey
  ) {
    issueLink = await createIssueLink(
      normalizeTicketKey(associationTarget),
      created.key,
      options.linkType
    );
  }

  return {
    success: true,
    ticket: created.key,
    ticketId: created.id,
    url: `${baseUrl}/browse/${created.key}`,
    project: options.project,
    summary: options.summary,
    issueType: issueType.name,
    parent: options.parent
      ? normalizeTicketKey(options.parent)
      : null,
    epic: options.epic ? normalizeTicketKey(options.epic) : null,
    issueLink,
    formatCheck: formatChecks,
    message: `已成功建立 Jira ticket: ${created.key}`,
  };
}

function showHelp() {
  console.log(`
🆕 Jira 開單工具

使用方法:
  node create-jira-ticket.mjs --project=FE --summary="標題" --description="內容"

必要參數:
  -p, --project=<key>       Jira 專案代碼（例如 FE）
  -s, --summary=<text>      Ticket 標題
  -d, --description=<text>  Ticket 描述（會轉為 ADF）
  --description-file=<path> 從檔案讀取描述（推薦：長內容/多段落）

選填參數:
  --issue-type=<name>       Issue type，預設為 Request
  --epic=<ticket>           掛到 Epic（會設定 parent + 史诗链接）
  --epic-link=<ticket>      --epic 的別名
  --parent=<ticket>         指定父單（Sub-task 必填；Request 也可掛到 Epic/父單）
  --link-type=<name>        無法直接設 parent/epic 時的 issue link 類型，預設「拆分为」
  --assignee=<user>         指定負責人
  --priority=<name>         指定優先級
  --labels="a,b"            設定 labels
  --components="A,B"        設定 components
  --skip-format-check       略過 LLM 格式檢查（直接送出原始內容）
  -h, --help                顯示此說明

範例:
  # 建立 Request 並掛到 Epic
  node create-jira-ticket.mjs \\
    --project=FE \\
    --issue-type=Request \\
    --summary="[AI] Jira 開單能力導入" \\
    --description="需求背景\\n\\n目前缺少 Jira 開單能力" \\
    --epic=FE-7840

  # 建立 Sub-task
  node create-jira-ticket.mjs \\
    --project=FE \\
    --issue-type=Sub-task \\
    --summary="實作 create-jira-ticket parent 支援" \\
    --description="補上 parent 與 expanded createmeta" \\
    --parent=FE-7893

  # 從 markdown 檔建立（避免 shell 轉義造成換行格式異常）
  node create-jira-ticket.mjs \\
    --project=FE \\
    --issue-type=Request \\
    --summary="[Evolve] one-pass optimization" \\
    --description-file=.evolve-tmp/fe-7840-request.md \\
    --parent=FE-7840

輸出:
  成功時輸出 JSON，包含 ticket、url、issueType、parent、epic、issueLink。
  失敗時輸出 JSON error 訊息。
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!args.project || !args.summary || !args.description) {
    showHelp();
    process.exit(1);
  }

  try {
    const result = await createJiraTicket(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

export {
  createJiraTicket,
  createIssueLink,
  findFieldKeyBySystem,
  getCreateFieldMeta,
  normalizeTicketKey,
};

main();

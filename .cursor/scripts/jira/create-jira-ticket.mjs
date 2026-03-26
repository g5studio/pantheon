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

function textToADF(text) {
  const paragraphs = text.split(/\n\n+/);

  return {
    version: 1,
    type: "doc",
    content: paragraphs.map((paragraph) => {
      const lines = paragraph.split(/\n/);

      if (lines.length === 1) {
        return {
          type: "paragraph",
          content: paragraph
            ? [{ type: "text", text: paragraph }]
            : [],
        };
      }

      const lineContent = [];
      lines.forEach((line, index) => {
        if (index > 0) {
          lineContent.push({ type: "hardBreak" });
        }

        if (line) {
          lineContent.push({ type: "text", text: line });
        }
      });

      return {
        type: "paragraph",
        content: lineContent,
      };
    }),
  };
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
  return requestJira(
    `/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`
  );
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

function parseArgs(args) {
  const result = {
    project: null,
    summary: null,
    description: null,
    issueType: "Request",
    epic: null,
    assignee: null,
    priority: null,
    labels: null,
    components: null,
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
    } else if (arg.startsWith("--issue-type=")) {
      result.issueType = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--epic=") || arg.startsWith("--epic-link=")) {
      result.epic = arg.split("=").slice(1).join("=");
    } else if (arg === "--epic" || arg === "--epic-link") {
      result.epic = args[++i];
    } else if (arg.startsWith("--assignee=")) {
      result.assignee = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--priority=")) {
      result.priority = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--labels=")) {
      result.labels = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--components=")) {
      result.components = arg.split("=").slice(1).join("=");
    }
  }

  return result;
}

function getEpicFieldKey(fieldMeta) {
  if (fieldMeta.parent) {
    return "parent";
  }

  const epicFieldEntry = Object.entries(fieldMeta).find(
    ([, meta]) => meta.name?.toLowerCase() === "epic link"
  );

  return epicFieldEntry?.[0] || null;
}

function getMissingRequiredFields(fieldMeta, fields) {
  const builtInFields = new Set(["project", "summary", "issuetype"]);

  return Object.entries(fieldMeta)
    .filter(([, meta]) => meta.required && !meta.hasDefaultValue)
    .filter(([fieldKey]) => !builtInFields.has(fieldKey))
    .filter(([fieldKey]) => fields[fieldKey] === undefined)
    .map(([fieldKey, meta]) => meta.name || fieldKey);
}

async function buildCreateFields(options, createMeta, issueType) {
  const fieldMeta = createMeta.fields || {};
  const fields = {
    project: { key: options.project },
    summary: options.summary,
    issuetype: { id: issueType.id },
  };

  if (options.description && fieldMeta.description) {
    fields.description = textToADF(options.description);
  }

  if (options.assignee && fieldMeta.assignee) {
    const users = await searchUsers(options.assignee);
    if (!users.length) {
      throw new Error(`找不到用戶: ${options.assignee}`);
    }
    fields.assignee = { accountId: users[0].accountId };
  }

  if (options.priority && fieldMeta.priority) {
    fields.priority = { name: options.priority };
  }

  if (options.labels && fieldMeta.labels) {
    fields.labels = options.labels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
  }

  if (options.components && fieldMeta.components) {
    fields.components = options.components
      .split(",")
      .map((component) => component.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }

  if (options.epic) {
    const epicKey = parseJiraUrl(options.epic) || options.epic.toUpperCase();

    if (!/^[A-Z0-9]+-\d+$/.test(epicKey)) {
      throw new Error(`無效的 Epic 格式: ${options.epic}`);
    }

    const epicFieldKey = getEpicFieldKey(fieldMeta);
    if (!epicFieldKey) {
      throw new Error("此 issue type 不支援 parent / Epic Link 欄位");
    }

    if (epicFieldKey === "parent") {
      fields.parent = { key: epicKey };
    } else {
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

  return fields;
}

async function createJiraTicket(options) {
  const issueType = await resolveIssueType(options.project, options.issueType);
  const createMeta = await getCreateFieldMeta(options.project, issueType.id);
  const fields = await buildCreateFields(options, createMeta, issueType);
  const created = await requestJira("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  const { baseUrl } = createApiConfig();

  return {
    success: true,
    ticket: created.key,
    ticketId: created.id,
    url: `${baseUrl}/browse/${created.key}`,
    project: options.project,
    summary: options.summary,
    issueType: issueType.name,
    epic: options.epic ? parseJiraUrl(options.epic) || options.epic : null,
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

選填參數:
  --issue-type=<name>       Issue type，預設為 Request
  --epic=<ticket>           指定要掛載的 Epic（例如 FE-7840）
  --epic-link=<ticket>      --epic 的別名
  --assignee=<user>         指定負責人
  --priority=<name>         指定優先級
  --labels="a,b"            設定 labels
  --components="A,B"        設定 components
  -h, --help                顯示此說明

範例:
  node create-jira-ticket.mjs \\
    --project=FE \\
    --issue-type=Request \\
    --summary="[AI] Jira 開單能力導入" \\
    --description="需求背景\\n\\n目前缺少 Jira 開單能力" \\
    --epic=FE-7840

輸出:
  成功時輸出 JSON，包含 ticket、url、issueType、epic。
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

export { createJiraTicket };

main();

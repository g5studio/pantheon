#!/usr/bin/env node

/**
 * Jira Ticket 更新腳本
 *
 * 提供對 Jira ticket 的完整控制，包括：
 * - 狀態切換（transition）
 * - 欄位更新（summary, description, assignee, priority, labels, components 等）
 * - Issue 關聯（建立/移除與其他 ticket 的關聯）
 * - Sprint 設置
 * - Fix Version 設置
 *
 * 使用方式：
 *   node update-jira.mjs <ticket> <action> [options]
 *
 * 動作列表：
 *   --transition, -t       切換狀態
 *   --update, -u           更新欄位
 *   --link, -l             建立關聯
 *   --unlink               移除關聯
 *   --info                 查看 ticket 資訊與可用選項
 *
 * 範例：
 *   # 切換狀態
 *   node update-jira.mjs FE-1234 --transition="In Progress"
 *
 *   # 更新欄位
 *   node update-jira.mjs FE-1234 --update --summary="新標題"
 *   node update-jira.mjs FE-1234 --update --assignee="william.chiang"
 *   node update-jira.mjs FE-1234 --update --priority="High"
 *   node update-jira.mjs FE-1234 --update --labels="bug,urgent"
 *   node update-jira.mjs FE-1234 --update --fix-version="5.36.0"
 *
 *   # 建立關聯
 *   node update-jira.mjs FE-1234 --link=FE-5678 --link-type="blocks"
 *   node update-jira.mjs FE-1234 --link=FE-5678 --link-type="is blocked by"
 *   node update-jira.mjs FE-1234 --link=FE-5678 --link-type="relates to"
 *
 *   # 移除關聯
 *   node update-jira.mjs FE-1234 --unlink=FE-5678
 *
 *   # 查看 ticket 資訊
 *   node update-jira.mjs FE-1234 --info
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";

// ============================================================================
// 工具函數
// ============================================================================

/**
 * 從 Jira URL 解析 ticket ID
 */
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

/**
 * 驗證 ticket 格式
 */
function validateTicket(ticket) {
  return /^[A-Z0-9]+-\d+$/.test(ticket);
}

/**
 * 建立 API 請求的基礎配置
 */
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

/**
 * 處理 API 錯誤回應
 */
async function handleApiError(response, context) {
  if (response.status === 404) {
    throw new Error(`找不到 ${context}`);
  } else if (response.status === 401 || response.status === 403) {
    throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
  } else if (response.status === 400) {
    const errorData = await response.json().catch(() => ({}));
    const errors =
      errorData.errorMessages?.join(", ") ||
      JSON.stringify(errorData.errors) ||
      response.statusText;
    throw new Error(`請求格式錯誤: ${errors}`);
  } else {
    throw new Error(`操作失敗: ${response.status} ${response.statusText}`);
  }
}

/**
 * 將純文字轉換為 ADF (Atlassian Document Format) 格式
 */
function textToADF(text) {
  const paragraphs = text.split(/\n\n+/);

  const content = paragraphs.map((paragraph) => {
    const lines = paragraph.split(/\n/);

    if (lines.length === 1) {
      return {
        type: "paragraph",
        content: [{ type: "text", text: paragraph }],
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

    return { type: "paragraph", content: lineContent };
  });

  return { version: 1, type: "doc", content };
}

// ============================================================================
// API 操作函數
// ============================================================================

/**
 * 獲取 ticket 詳細資訊
 */
async function getTicketInfo(ticket) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}?expand=transitions,editmeta`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `Jira ticket: ${ticket}`);
  }

  return response.json();
}

/**
 * 獲取可用的狀態轉換
 */
async function getAvailableTransitions(ticket) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/transitions`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `Jira ticket: ${ticket}`);
  }

  const data = await response.json();
  return data.transitions || [];
}

/**
 * 執行狀態轉換
 */
async function executeTransition(ticket, transitionId) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/transitions`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transition: { id: transitionId },
    }),
  });

  if (!response.ok) {
    await handleApiError(response, `狀態轉換`);
  }

  return true;
}

/**
 * 更新 ticket 欄位
 */
async function updateFields(ticket, fields) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}`;

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    await handleApiError(response, `欄位更新`);
  }

  return true;
}

/**
 * 獲取可用的 Issue Link 類型
 */
async function getIssueLinkTypes() {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/issueLinkType`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `Issue Link 類型`);
  }

  const data = await response.json();
  return data.issueLinkTypes || [];
}

/**
 * 建立 Issue Link
 */
async function createIssueLink(
  sourceTicket,
  targetTicket,
  linkTypeName,
  isOutward = true
) {
  const { auth, baseUrl } = createApiConfig();

  // 獲取 link 類型
  const linkTypes = await getIssueLinkTypes();
  const linkType = linkTypes.find(
    (lt) =>
      lt.name.toLowerCase() === linkTypeName.toLowerCase() ||
      lt.inward.toLowerCase() === linkTypeName.toLowerCase() ||
      lt.outward.toLowerCase() === linkTypeName.toLowerCase()
  );

  if (!linkType) {
    const availableTypes = linkTypes
      .map((lt) => `"${lt.name}" (${lt.inward} / ${lt.outward})`)
      .join(", ");
    throw new Error(
      `找不到 Link 類型 "${linkTypeName}"。可用類型: ${availableTypes}`
    );
  }

  // 判斷方向
  const isInward = linkType.inward.toLowerCase() === linkTypeName.toLowerCase();

  const apiUrl = `${baseUrl}/rest/api/3/issueLink`;

  const requestBody = {
    type: { name: linkType.name },
    inwardIssue: { key: isInward ? sourceTicket : targetTicket },
    outwardIssue: { key: isInward ? targetTicket : sourceTicket },
  };

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
    await handleApiError(response, `Issue Link 建立`);
  }

  return {
    success: true,
    type: linkType.name,
    direction: isInward ? "inward" : "outward",
    source: sourceTicket,
    target: targetTicket,
  };
}

/**
 * 獲取 ticket 的所有 links
 */
async function getIssueLinks(ticket) {
  const ticketInfo = await getTicketInfo(ticket);
  return ticketInfo.fields?.issuelinks || [];
}

/**
 * 移除 Issue Link
 */
async function removeIssueLink(sourceTicket, targetTicket) {
  const { auth, baseUrl } = createApiConfig();

  // 獲取現有的 links
  const links = await getIssueLinks(sourceTicket);

  // 找到與目標 ticket 相關的 link
  const targetLink = links.find(
    (link) =>
      link.inwardIssue?.key === targetTicket ||
      link.outwardIssue?.key === targetTicket
  );

  if (!targetLink) {
    throw new Error(`找不到 ${sourceTicket} 與 ${targetTicket} 之間的關聯`);
  }

  const apiUrl = `${baseUrl}/rest/api/3/issueLink/${targetLink.id}`;

  const response = await fetch(apiUrl, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `Issue Link 移除`);
  }

  return {
    success: true,
    removedLink: {
      id: targetLink.id,
      type: targetLink.type?.name,
      source: sourceTicket,
      target: targetTicket,
    },
  };
}

/**
 * 獲取專案資訊（用於獲取可用的 fix versions, components 等）
 */
async function getProjectInfo(projectKey) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/project/${projectKey}`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `專案: ${projectKey}`);
  }

  return response.json();
}

/**
 * 獲取專案的版本列表
 */
async function getProjectVersions(projectKey) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/project/${projectKey}/versions`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `專案版本: ${projectKey}`);
  }

  return response.json();
}

/**
 * 獲取專案的 Sprints（透過 Agile API）
 */
async function getBoardSprints(boardId) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active,future`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `Board Sprints`);
  }

  const data = await response.json();
  return data.values || [];
}

/**
 * 獲取用戶資訊
 */
async function searchUsers(query) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(
    query
  )}&maxResults=10`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    await handleApiError(response, `用戶搜尋`);
  }

  return response.json();
}

/**
 * 設置 Sprint
 */
async function setSprintField(ticket, sprintId) {
  const { auth, baseUrl } = createApiConfig();
  const apiUrl = `${baseUrl}/rest/agile/1.0/issue/${ticket}`;

  // 先嘗試獲取 ticket 資訊以確認 sprint 欄位名稱
  const ticketInfo = await getTicketInfo(ticket);

  // 找到 sprint 欄位（通常是 customfield_xxxxx）
  const sprintFieldKey =
    Object.keys(ticketInfo.fields || {}).find(
      (key) =>
        key.startsWith("customfield_") &&
        Array.isArray(ticketInfo.fields[key]) &&
        ticketInfo.fields[key][0]?.name?.toLowerCase().includes("sprint")
    ) || "customfield_10020"; // 常見的 sprint 欄位

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        [sprintFieldKey]: sprintId,
      },
    }),
  });

  if (!response.ok) {
    // 嘗試使用標準 API
    return updateFields(ticket, { [sprintFieldKey]: sprintId });
  }

  return true;
}

// ============================================================================
// 命令處理函數
// ============================================================================

/**
 * 處理狀態轉換
 */
async function handleTransition(ticket, targetStatus) {
  // 獲取可用的轉換
  const transitions = await getAvailableTransitions(ticket);

  // 找到匹配的轉換
  const matchedTransition = transitions.find(
    (t) =>
      t.name.toLowerCase() === targetStatus.toLowerCase() ||
      t.to?.name?.toLowerCase() === targetStatus.toLowerCase()
  );

  if (!matchedTransition) {
    const availableNames = transitions
      .map((t) => `"${t.name}" (→ ${t.to?.name || "未知"})`)
      .join(", ");
    throw new Error(
      `找不到目標狀態 "${targetStatus}"。可用的轉換: ${availableNames || "無"}`
    );
  }

  // 獲取當前狀態
  const ticketInfo = await getTicketInfo(ticket);
  const previousStatus = ticketInfo.fields?.status?.name || "未知";

  // 執行轉換
  await executeTransition(ticket, matchedTransition.id);

  // 獲取新狀態
  const newInfo = await getTicketInfo(ticket);
  const currentStatus = newInfo.fields?.status?.name || "未知";

  return {
    success: true,
    ticket,
    action: "transition",
    previousStatus,
    transitionExecuted: matchedTransition.name,
    currentStatus,
  };
}

/**
 * 處理欄位更新
 */
async function handleFieldUpdate(ticket, options) {
  const fieldsToUpdate = {};
  const updates = [];

  // Summary（標題）
  if (options.summary) {
    fieldsToUpdate.summary = options.summary;
    updates.push({ field: "summary", value: options.summary });
  }

  // Description（描述）
  if (options.description) {
    fieldsToUpdate.description = textToADF(options.description);
    updates.push({ field: "description", value: "(ADF content)" });
  }

  // Assignee（負責人）
  if (options.assignee) {
    // 搜尋用戶
    const users = await searchUsers(options.assignee);
    if (users.length === 0) {
      throw new Error(`找不到用戶: ${options.assignee}`);
    }
    fieldsToUpdate.assignee = { accountId: users[0].accountId };
    updates.push({ field: "assignee", value: users[0].displayName });
  }

  // Priority（優先級）
  if (options.priority) {
    fieldsToUpdate.priority = { name: options.priority };
    updates.push({ field: "priority", value: options.priority });
  }

  // Labels（標籤）
  if (options.labels) {
    const labelList = options.labels.split(",").map((l) => l.trim());
    fieldsToUpdate.labels = labelList;
    updates.push({ field: "labels", value: labelList.join(", ") });
  }

  // Add Labels（新增標籤，保留現有）
  if (options.addLabels) {
    const ticketInfo = await getTicketInfo(ticket);
    const existingLabels = ticketInfo.fields?.labels || [];
    const newLabels = options.addLabels.split(",").map((l) => l.trim());
    const mergedLabels = [...new Set([...existingLabels, ...newLabels])];
    fieldsToUpdate.labels = mergedLabels;
    updates.push({ field: "labels (add)", value: newLabels.join(", ") });
  }

  // Remove Labels（移除標籤）
  if (options.removeLabels) {
    const ticketInfo = await getTicketInfo(ticket);
    const existingLabels = ticketInfo.fields?.labels || [];
    const labelsToRemove = options.removeLabels
      .split(",")
      .map((l) => l.trim().toLowerCase());
    const filteredLabels = existingLabels.filter(
      (l) => !labelsToRemove.includes(l.toLowerCase())
    );
    fieldsToUpdate.labels = filteredLabels;
    updates.push({ field: "labels (remove)", value: options.removeLabels });
  }

  // Components（組件）
  if (options.components) {
    const componentList = options.components
      .split(",")
      .map((c) => ({ name: c.trim() }));
    fieldsToUpdate.components = componentList;
    updates.push({ field: "components", value: options.components });
  }

  // Fix Version
  if (options.fixVersion) {
    const projectKey = ticket.split("-")[0];
    const versions = await getProjectVersions(projectKey);
    const matchedVersion = versions.find(
      (v) =>
        v.name === options.fixVersion || v.name.includes(options.fixVersion)
    );

    if (!matchedVersion) {
      const availableVersions = versions
        .filter((v) => !v.released)
        .slice(0, 10)
        .map((v) => v.name)
        .join(", ");
      throw new Error(
        `找不到版本 "${options.fixVersion}"。可用版本: ${
          availableVersions || "無"
        }`
      );
    }

    fieldsToUpdate.fixVersions = [{ id: matchedVersion.id }];
    updates.push({ field: "fixVersions", value: matchedVersion.name });
  }

  // Add Fix Version（新增 fix version，保留現有）
  if (options.addFixVersion) {
    const projectKey = ticket.split("-")[0];
    const versions = await getProjectVersions(projectKey);
    const matchedVersion = versions.find(
      (v) =>
        v.name === options.addFixVersion ||
        v.name.includes(options.addFixVersion)
    );

    if (!matchedVersion) {
      throw new Error(`找不到版本 "${options.addFixVersion}"`);
    }

    const ticketInfo = await getTicketInfo(ticket);
    const existingVersions = ticketInfo.fields?.fixVersions || [];
    const existingIds = existingVersions.map((v) => v.id);

    if (!existingIds.includes(matchedVersion.id)) {
      fieldsToUpdate.fixVersions = [
        ...existingVersions.map((v) => ({ id: v.id })),
        { id: matchedVersion.id },
      ];
      updates.push({ field: "fixVersions (add)", value: matchedVersion.name });
    }
  }

  // Due Date（到期日）
  if (options.dueDate) {
    fieldsToUpdate.duedate = options.dueDate; // 格式: YYYY-MM-DD
    updates.push({ field: "duedate", value: options.dueDate });
  }

  // Story Points
  if (options.storyPoints) {
    // 常見的 story points 欄位名稱
    const storyPointsField = "customfield_10028";
    fieldsToUpdate[storyPointsField] = parseFloat(options.storyPoints);
    updates.push({ field: "storyPoints", value: options.storyPoints });
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    throw new Error("沒有指定要更新的欄位");
  }

  // 執行更新
  await updateFields(ticket, fieldsToUpdate);

  return {
    success: true,
    ticket,
    action: "update",
    updatedFields: updates,
  };
}

/**
 * 處理 Issue Link 建立
 */
async function handleLink(sourceTicket, targetTicket, linkType) {
  const result = await createIssueLink(sourceTicket, targetTicket, linkType);
  return {
    success: true,
    ticket: sourceTicket,
    action: "link",
    ...result,
  };
}

/**
 * 處理 Issue Link 移除
 */
async function handleUnlink(sourceTicket, targetTicket) {
  const result = await removeIssueLink(sourceTicket, targetTicket);
  return {
    success: true,
    ticket: sourceTicket,
    action: "unlink",
    ...result,
  };
}

/**
 * 顯示 ticket 詳細資訊
 */
async function handleInfo(ticket) {
  const { baseUrl } = createApiConfig();
  const ticketInfo = await getTicketInfo(ticket);
  const transitions = await getAvailableTransitions(ticket);
  const links = ticketInfo.fields?.issuelinks || [];
  const linkTypes = await getIssueLinkTypes();

  // 獲取專案版本
  const projectKey = ticket.split("-")[0];
  let versions = [];
  try {
    versions = await getProjectVersions(projectKey);
  } catch (e) {
    // 忽略錯誤
  }

  return {
    ticket,
    url: `${baseUrl}/browse/${ticket}`,
    summary: ticketInfo.fields?.summary,
    status: ticketInfo.fields?.status?.name,
    issueType: ticketInfo.fields?.issuetype?.name,
    priority: ticketInfo.fields?.priority?.name,
    assignee: ticketInfo.fields?.assignee?.displayName || "未分配",
    reporter: ticketInfo.fields?.reporter?.displayName,
    labels: ticketInfo.fields?.labels || [],
    components: (ticketInfo.fields?.components || []).map((c) => c.name),
    fixVersions: (ticketInfo.fields?.fixVersions || []).map((v) => v.name),
    dueDate: ticketInfo.fields?.duedate,
    created: ticketInfo.fields?.created,
    updated: ticketInfo.fields?.updated,

    availableTransitions: transitions.map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name,
    })),

    currentLinks: links.map((link) => ({
      type: link.type?.name,
      direction: link.inwardIssue ? "inward" : "outward",
      linkedTicket: link.inwardIssue?.key || link.outwardIssue?.key,
      linkedSummary:
        link.inwardIssue?.fields?.summary || link.outwardIssue?.fields?.summary,
    })),

    availableLinkTypes: linkTypes.map((lt) => ({
      name: lt.name,
      inward: lt.inward,
      outward: lt.outward,
    })),

    availableVersions: versions
      .filter((v) => !v.released)
      .slice(0, 15)
      .map((v) => v.name),
  };
}

// ============================================================================
// 命令行解析
// ============================================================================

function parseArgs(args) {
  const result = {
    ticket: null,
    action: null,
    // Transition
    transition: null,
    // Update fields
    update: false,
    summary: null,
    description: null,
    assignee: null,
    priority: null,
    labels: null,
    addLabels: null,
    removeLabels: null,
    components: null,
    fixVersion: null,
    addFixVersion: null,
    dueDate: null,
    storyPoints: null,
    sprint: null,
    // Link
    link: null,
    linkType: "relates to",
    unlink: null,
    // Info
    info: false,
    // Help
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--info") {
      result.info = true;
      result.action = "info";
    } else if (arg === "--update" || arg === "-u") {
      result.update = true;
      result.action = "update";
    } else if (arg.startsWith("--transition=") || arg.startsWith("-t=")) {
      result.transition = arg.split("=").slice(1).join("=");
      result.action = "transition";
    } else if (arg === "--transition" || arg === "-t") {
      result.transition = args[++i];
      result.action = "transition";
    } else if (arg.startsWith("--summary=")) {
      result.summary = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--description=")) {
      result.description = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--assignee=")) {
      result.assignee = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--priority=")) {
      result.priority = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--labels=")) {
      result.labels = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--add-labels=")) {
      result.addLabels = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--remove-labels=")) {
      result.removeLabels = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--components=")) {
      result.components = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--fix-version=")) {
      result.fixVersion = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--add-fix-version=")) {
      result.addFixVersion = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--due-date=")) {
      result.dueDate = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--story-points=")) {
      result.storyPoints = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--sprint=")) {
      result.sprint = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--link=") || arg.startsWith("-l=")) {
      result.link = arg.split("=").slice(1).join("=");
      result.action = "link";
    } else if (arg === "--link" || arg === "-l") {
      result.link = args[++i];
      result.action = "link";
    } else if (arg.startsWith("--link-type=")) {
      result.linkType = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--unlink=")) {
      result.unlink = arg.split("=").slice(1).join("=");
      result.action = "unlink";
    } else if (arg === "--unlink") {
      result.unlink = args[++i];
      result.action = "unlink";
    } else if (!arg.startsWith("-") && !result.ticket) {
      result.ticket = arg;
    }
  }

  return result;
}

function showHelp() {
  console.log(`
📋 Jira Ticket 更新工具

使用方法:
  node update-jira.mjs <ticket> <action> [options]

動作:
  --info                    查看 ticket 詳細資訊與可用選項
  --transition, -t <status> 切換到指定狀態
  --update, -u              更新欄位（配合以下欄位選項使用）
  --link, -l <ticket>       建立與另一個 ticket 的關聯
  --unlink <ticket>         移除與另一個 ticket 的關聯

欄位選項（配合 --update 使用）:
  --summary="新標題"         更新標題
  --description="新描述"     更新描述
  --assignee="username"      設置負責人
  --priority="High"          設置優先級（Highest/High/Medium/Low/Lowest）
  --labels="bug,urgent"      設置標籤（覆蓋現有）
  --add-labels="new-label"   新增標籤（保留現有）
  --remove-labels="old"      移除指定標籤
  --components="Frontend"    設置組件
  --fix-version="5.36.0"     設置 Fix Version（覆蓋現有）
  --add-fix-version="5.36.0" 新增 Fix Version（保留現有）
  --due-date="2024-12-31"    設置到期日
  --story-points="3"         設置 Story Points

關聯選項:
  --link-type="blocks"       指定關聯類型（預設: relates to）
    可用類型: blocks, is blocked by, clones, is cloned by,
             duplicates, is duplicated by, relates to

範例:
  # 查看 ticket 資訊（包含可用的狀態轉換、關聯類型等）
  node update-jira.mjs FE-1234 --info

  # 切換狀態
  node update-jira.mjs FE-1234 --transition="In Progress"
  node update-jira.mjs FE-1234 -t "Code Review"

  # 更新多個欄位
  node update-jira.mjs FE-1234 --update --summary="新標題" --priority="High"
  node update-jira.mjs FE-1234 --update --assignee="william.chiang"
  node update-jira.mjs FE-1234 --update --add-labels="urgent,needs-review"
  node update-jira.mjs FE-1234 --update --fix-version="5.36.0"

  # 建立關聯
  node update-jira.mjs FE-1234 --link=FE-5678 --link-type="blocks"
  node update-jira.mjs FE-1234 --link=FE-5678 --link-type="is blocked by"
  node update-jira.mjs FE-1234 --link=FE-5678 --link-type="relates to"

  # 移除關聯
  node update-jira.mjs FE-1234 --unlink=FE-5678

輸出:
  所有輸出均為 JSON 格式，便於程式處理。
  成功時會包含 success: true 和相關操作結果。
  失敗時會包含 error 訊息。
`);
}

// ============================================================================
// 主程式
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(1);
  }

  const parsed = parseArgs(args);

  if (parsed.help) {
    showHelp();
    process.exit(0);
  }

  if (!parsed.ticket) {
    console.error(JSON.stringify({ error: "請提供 Jira ticket ID" }, null, 2));
    process.exit(1);
  }

  // 解析 ticket ID
  const ticket = parseJiraUrl(parsed.ticket) || parsed.ticket.toUpperCase();

  if (!validateTicket(ticket)) {
    console.error(
      JSON.stringify(
        { error: `無效的 Jira ticket 格式: ${parsed.ticket}` },
        null,
        2
      )
    );
    process.exit(1);
  }

  try {
    let result;

    switch (parsed.action) {
      case "info":
        result = await handleInfo(ticket);
        break;

      case "transition":
        if (!parsed.transition) {
          throw new Error("請指定目標狀態（使用 --transition=<status>）");
        }
        result = await handleTransition(ticket, parsed.transition);
        break;

      case "update":
        result = await handleFieldUpdate(ticket, parsed);
        break;

      case "link":
        if (!parsed.link) {
          throw new Error("請指定要關聯的 ticket（使用 --link=<ticket>）");
        }
        const targetTicket =
          parseJiraUrl(parsed.link) || parsed.link.toUpperCase();
        if (!validateTicket(targetTicket)) {
          throw new Error(`無效的目標 ticket 格式: ${parsed.link}`);
        }
        result = await handleLink(ticket, targetTicket, parsed.linkType);
        break;

      case "unlink":
        if (!parsed.unlink) {
          throw new Error(
            "請指定要移除關聯的 ticket（使用 --unlink=<ticket>）"
          );
        }
        const unlinkTarget =
          parseJiraUrl(parsed.unlink) || parsed.unlink.toUpperCase();
        if (!validateTicket(unlinkTarget)) {
          throw new Error(`無效的目標 ticket 格式: ${parsed.unlink}`);
        }
        result = await handleUnlink(ticket, unlinkTarget);
        break;

      default:
        // 如果有指定更新欄位但沒有 --update flag，自動觸發更新
        if (
          parsed.summary ||
          parsed.description ||
          parsed.assignee ||
          parsed.priority ||
          parsed.labels ||
          parsed.addLabels ||
          parsed.removeLabels ||
          parsed.components ||
          parsed.fixVersion ||
          parsed.addFixVersion ||
          parsed.dueDate ||
          parsed.storyPoints
        ) {
          result = await handleFieldUpdate(ticket, parsed);
        } else {
          // 預設顯示 info
          result = await handleInfo(ticket);
        }
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

// 導出函數供其他模組使用
export {
  getTicketInfo,
  getAvailableTransitions,
  executeTransition,
  updateFields,
  getIssueLinkTypes,
  createIssueLink,
  removeIssueLink,
  getProjectVersions,
  searchUsers,
  handleTransition,
  handleFieldUpdate,
  handleLink,
  handleUnlink,
  handleInfo,
};

main();

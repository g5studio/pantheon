#!/usr/bin/env node

/**
 * Jira Ticket 狀態切換腳本
 *
 * 功能：
 * 1. 列出 Jira ticket 可用的狀態轉換
 * 2. 執行狀態轉換（切換 ticket 狀態）
 *
 * 使用方式：
 *   # 列出可用的狀態轉換
 *   node transition-jira-ticket.mjs <ticket> --list
 *
 *   # 執行狀態轉換（指定 transition ID）
 *   node transition-jira-ticket.mjs <ticket> --transition=<transition-id>
 *
 *   # 執行狀態轉換（指定目標狀態名稱）
 *   node transition-jira-ticket.mjs <ticket> --to="In Progress"
 *
 * 範例：
 *   node transition-jira-ticket.mjs FE-1234 --list
 *   node transition-jira-ticket.mjs FE-1234 --transition=21
 *   node transition-jira-ticket.mjs FE-1234 --to="Code Review"
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

// 解析命令行參數
function parseArgs(args) {
  const result = {
    ticket: null,
    list: false,
    transitionId: null,
    targetStatus: null,
  };

  for (const arg of args) {
    if (arg === "--list" || arg === "-l") {
      result.list = true;
    } else if (arg.startsWith("--transition=")) {
      result.transitionId = arg.split("=")[1];
    } else if (arg.startsWith("--to=")) {
      result.targetStatus = arg.split("=").slice(1).join("="); // 處理狀態名稱中可能有 = 的情況
    } else if (!arg.startsWith("-")) {
      result.ticket = arg;
    }
  }

  return result;
}

// 獲取可用的狀態轉換
async function getAvailableTransitions(ticket, config) {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/transitions`;

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
        `獲取狀態轉換失敗: ${response.status} ${response.statusText}`
      );
    }
  }

  const data = await response.json();
  return data.transitions || [];
}

// 獲取 ticket 當前狀態
async function getCurrentStatus(ticket, config) {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}?fields=status,summary`;

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
        `獲取 ticket 資訊失敗: ${response.status} ${response.statusText}`
      );
    }
  }

  const data = await response.json();
  return {
    status: data.fields?.status?.name || "未知",
    statusId: data.fields?.status?.id,
    summary: data.fields?.summary || "",
  };
}

// 執行狀態轉換
async function executeTransition(ticket, transitionId, config) {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/transitions`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transition: {
        id: transitionId,
      },
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`找不到 Jira ticket: ${ticket}`);
    } else if (response.status === 401 || response.status === 403) {
      throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
    } else if (response.status === 400) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `狀態轉換失敗: ${errorData.errorMessages?.join(", ") || "無效的轉換"}`
      );
    } else {
      throw new Error(
        `狀態轉換失敗: ${response.status} ${response.statusText}`
      );
    }
  }

  // 204 No Content 表示成功
  return true;
}

// 列出可用的狀態轉換
async function listTransitions(ticket) {
  const config = getJiraConfig();

  // 獲取當前狀態
  const currentInfo = await getCurrentStatus(ticket, config);

  // 獲取可用轉換
  const transitions = await getAvailableTransitions(ticket, config);

  return {
    ticket,
    url: `${config.baseUrl.replace(/\/$/, "")}/browse/${ticket}`,
    summary: currentInfo.summary,
    currentStatus: currentInfo.status,
    availableTransitions: transitions.map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name || "未知",
    })),
  };
}

// 執行狀態轉換（主函數）
async function transitionTicket(ticket, transitionIdOrStatus, isStatusName) {
  const config = getJiraConfig();

  // 獲取當前狀態
  const currentInfo = await getCurrentStatus(ticket, config);

  let transitionId = transitionIdOrStatus;
  let transitionName = "";

  // 如果是狀態名稱，需要查找對應的 transition ID
  if (isStatusName) {
    const transitions = await getAvailableTransitions(ticket, config);
    const targetStatus = transitionIdOrStatus.toLowerCase();

    const matchedTransition = transitions.find(
      (t) =>
        t.name.toLowerCase() === targetStatus ||
        t.to?.name?.toLowerCase() === targetStatus
    );

    if (!matchedTransition) {
      const availableNames = transitions
        .map((t) => `"${t.name}" (→ ${t.to?.name || "未知"})`)
        .join(", ");
      throw new Error(
        `找不到目標狀態 "${transitionIdOrStatus}"。可用的轉換: ${
          availableNames || "無"
        }`
      );
    }

    transitionId = matchedTransition.id;
    transitionName = matchedTransition.name;
  } else {
    // 驗證 transition ID 是否有效
    const transitions = await getAvailableTransitions(ticket, config);
    const matchedTransition = transitions.find((t) => t.id === transitionId);

    if (!matchedTransition) {
      const availableIds = transitions
        .map((t) => `${t.id} (${t.name})`)
        .join(", ");
      throw new Error(
        `無效的 transition ID "${transitionId}"。可用的 ID: ${
          availableIds || "無"
        }`
      );
    }

    transitionName = matchedTransition.name;
  }

  // 執行轉換
  await executeTransition(ticket, transitionId, config);

  // 獲取轉換後的狀態
  const newInfo = await getCurrentStatus(ticket, config);

  return {
    ticket,
    url: `${config.baseUrl.replace(/\/$/, "")}/browse/${ticket}`,
    summary: currentInfo.summary,
    previousStatus: currentInfo.status,
    transitionExecuted: transitionName,
    currentStatus: newInfo.status,
    success: true,
  };
}

// 顯示使用說明
function showUsage() {
  console.error("❌ 使用方式錯誤\n");
  console.error("使用方法:");
  console.error(
    "  node transition-jira-ticket.mjs <ticket> --list              列出可用的狀態轉換"
  );
  console.error(
    "  node transition-jira-ticket.mjs <ticket> --transition=<id>   執行指定 ID 的轉換"
  );
  console.error(
    '  node transition-jira-ticket.mjs <ticket> --to="<status>"     轉換到指定狀態'
  );
  console.error("\n範例:");
  console.error("  node transition-jira-ticket.mjs FE-1234 --list");
  console.error("  node transition-jira-ticket.mjs FE-1234 --transition=21");
  console.error('  node transition-jira-ticket.mjs FE-1234 --to="In Progress"');
  console.error('  node transition-jira-ticket.mjs FE-1234 --to="Code Review"');
}

// 主函數
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showUsage();
    process.exit(1);
  }

  const parsed = parseArgs(args);

  if (!parsed.ticket) {
    showUsage();
    process.exit(1);
  }

  // 解析 ticket ID
  const ticket = parseJiraUrl(parsed.ticket) || parsed.ticket.toUpperCase();

  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
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
    if (parsed.list) {
      // 列出可用的狀態轉換
      const result = await listTransitions(ticket);
      console.log(JSON.stringify(result, null, 2));
    } else if (parsed.transitionId) {
      // 執行指定 ID 的轉換
      const result = await transitionTicket(ticket, parsed.transitionId, false);
      console.log(JSON.stringify(result, null, 2));
    } else if (parsed.targetStatus) {
      // 執行指定狀態名稱的轉換
      const result = await transitionTicket(ticket, parsed.targetStatus, true);
      console.log(JSON.stringify(result, null, 2));
    } else {
      showUsage();
      process.exit(1);
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();

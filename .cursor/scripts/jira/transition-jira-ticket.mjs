#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/jira/transition-jira-ticket.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * 檔案用途區塊
 * @module transition-jira-ticket
 * @purpose Jira Ticket 狀態切換腳本（列出可用 transitions / 執行 transition 或依目標狀態名稱轉換）。
 * 本腳本會呼叫 Jira REST API 與命令列參數進行狀態查詢與切換。
 */

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

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析輸入字串中的 Jira ticket ID。
 * @purpose 依 URL (/browse/<TICKET>) 或直接輸入的字串形式萃取票號。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
function parseJiraUrl(url) {
  // 格式: https://innotech.atlassian.net/browse/{ticket} 或直接是 ticket ID
  if (!url.includes("/")) {
    // 直接是 ticket ID
    return url.toUpperCase();
  }

  /**
   * 宣告內容用途說明與單號關聯
   * @description 使用 /browse/<TICKET> 形式提取 ticket ID。
   * @purpose 針對包含 /browse/ 的 URL 做票號抽取。
   * @external https://innotech.atlassian.net/browse/FE-7892
   */
  const match = url.match(/\/browse\/([A-Z0-9]+-\d+)/);
  if (match) {
    return match[1];
  }

  // 嘗試直接匹配 ticket 格式
  /**
   * 宣告內容用途說明與單號關聯
   * @description 直接從字串中匹配 <PROJECT>-<NUMBER> 格式的 ticket ID。
   * @purpose 從字串中抓取可能的 Jira 票號片段。
   * @external https://innotech.atlassian.net/browse/FE-7892
   */
  const ticketMatch = url.match(/([A-Z0-9]+-\d+)/);
  if (ticketMatch) {
    return ticketMatch[1];
  }

  return null;
}

// 解析命令行參數
/**
 * 宣告內容用途說明與單號關聯
 * @description 解析命令列參數並回傳結構化設定。
 * @purpose 將 --list / --transition / --to 及 ticket 參數轉成可用的結構。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
function parseArgs(args) {
  /**
   * 宣告內容用途說明與單號關聯
   * @description 命令列參數解析結果。
   * @purpose 收納 ticket、list、transitionId、targetStatus 等狀態。
   * @external https://innotech.atlassian.net/browse/FE-7892
   */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 取得指定 ticket 的可用 transitions。
 * @purpose 呼叫 Jira transitions API 取得目前可執行的狀態轉換清單。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 取得指定 ticket 的目前狀態資訊（status name/id 與 summary）。
 * @purpose 呼叫 Jira issue API 取得目前狀態與摘要。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 使用 transition ID 對指定 ticket 發送狀態轉換請求。
 * @purpose 透過 Jira transitions API 以 transition id 進行狀態切換。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 列出指定 ticket 在目前狀態下可用的 transitions。
 * @purpose 整合目前狀態與 transitions 清單，輸出可用轉換結果。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 執行狀態轉換：可支援以 transition ID 或目標狀態名稱指定。
 * @purpose 以 transitionId 或目標狀態名稱查找對應 transition，並完成狀態切換後回傳結果。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 在錯誤或參數不足時輸出指令使用方式。
 * @purpose 提供 CLI 使用提示與範例。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 入口：解析參數、執行 list/transition，並處理錯誤輸出。
 * @purpose 依輸入參數決定是列出 transitions 或執行狀態轉換。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
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

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactoring-engine
 * @llm-review-note 僅調整 JSDoc 註解結構並補齊三段式標註；不改動程式邏輯。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T17:56:03.675Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 調整檔案註解為三段式佈局並修正宣告級 JSDoc 的 @external 標註格式為對應 FE-7892，移除多餘/重複的 llm 分析紀錄區註解（不動程式邏輯）。
 */

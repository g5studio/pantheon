#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module agent-communicator
 * @purpose Hermes Communicator CLI：show-config / ping / resolve-target / send。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */

import {
  buildCommunicatorMessage,
  getCommunicatorAgentConfig,
  isCommunicatorAgentEnabled,
  resolveCommunicatorTarget,
  resolveRecipientDisplayName,
  sendCommunicatorNotification,
} from "../client/communicator-agent-client.mjs";
import { getAgentDisplayName, getJiraEmail } from "../utilities/env-loader.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 CLI 參數為 key-value map。
 * @purpose 支援 `--action=ping` 格式。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      result[body] = true;
      continue;
    }
    const key = body.slice(0, eqIndex);
    const value = body.slice(eqIndex + 1);
    result[key] = value;
  }
  return result;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 印出 CLI 使用說明。
 * @purpose 缺少必要參數時提示使用者。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
function printUsage() {
  console.error(`
Hermes Communicator CLI

Usage:
  pnpm run agent-communicator -- --action=<action> [options]

Actions:
  show-config      顯示 Communicator 設定（不連線）
  resolve-target   解析 COMMUNICATOR_AGENT_TARGET（必要時查 company-members 並寫入 .env.local）
  ping             解析 target 後送出測試訊息
  send             送出自訂通知（可選 --title / --message / --url）

Options:
  --title=<text>     send / ping 標題（預設 pantheon）
  --message=<text>   send / ping 訊息（預設 Communicator ping）
  --url=<text>       send 附加連結
  --force-refresh    resolve-target 強制重新查 company-members

Env:
  COMMUNICATOR_AGENT_API_URL
  COMMUNICATOR_AGENT_API_TOKEN   （未設定時使用內建預設 token）
  COMMUNICATOR_AGENT_TARGET      （未設定時自動解析）
  JIRA_EMAIL                     （target 自動解析用）

Examples:
  pnpm run agent-communicator -- --action=show-config
  pnpm run agent-communicator -- --action=resolve-target
  pnpm run agent-communicator -- --action=ping
  pnpm run agent-communicator -- --action=send --title=pantheon --message="Push complete"
`.trim());
}

/**
 * 宣告內容用途說明與單號關聯
 * @description CLI 主流程。
 * @purpose 提供 show-config / resolve-target / ping / send 操作。
 * @external https://innotech.atlassian.net/browse/FE-8429
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = String(args.action || "").trim().toLowerCase();

  if (!action) {
    printUsage();
    process.exit(1);
  }

  if (action === "show-config") {
    const config = getCommunicatorAgentConfig();
    console.log(
      JSON.stringify(
        {
          ok: true,
          enabled: config.enabled,
          apiUrl: config.apiUrl || null,
          target: config.target || null,
          usingDefaultToken: config.usingDefaultToken,
          envKeys: [
            "COMMUNICATOR_AGENT_API_URL",
            "COMMUNICATOR_AGENT_API_TOKEN",
            "COMMUNICATOR_AGENT_TARGET",
            "JIRA_EMAIL",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!isCommunicatorAgentEnabled()) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          skipped: true,
          reason: "communicator-disabled",
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (action === "resolve-target") {
    const forceRefresh = Boolean(args["force-refresh"]);
    const result = await resolveCommunicatorTarget({ forceRefresh });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const title = String(args.title || "pantheon").trim();
  const message = String(args.message || "Communicator ping").trim();
  const url = String(args.url || "").trim();

  if (action === "ping" || action === "send") {
    const config = getCommunicatorAgentConfig();
    const email = getJiraEmail();
    const recipientName = email
      ? await resolveRecipientDisplayName(config, email)
      : "there";
    const result = await sendCommunicatorNotification({ title, message, url });
    console.log(
      JSON.stringify(
        {
          ...result,
          previewMessage: buildCommunicatorMessage({
            recipientName,
            agentDisplayName: getAgentDisplayName() || "",
            title,
            message,
            url,
          }),
        },
        null,
        2,
      ),
    );
    process.exit(result.ok ? 0 : result.skipped ? 0 : 1);
  }

  printUsage();
  process.exit(1);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-23T00:00:00.000Z
 * @llm-review-model composer
 * @llm-review-note 新增 agent-communicator CLI，供 Hermes 設定檢查與發送測試（FE-8429）。
 */

#!/usr/bin/env node

/**
 * 保存 start-task 開發計劃到 `.cursor/tmp/{ticket}/merge-request-description-info.json`
 *
 * 使用方式：
 *   node .cursor/scripts/operator/save-start-task-info.mjs --ticket=IN-107113 --target="..." --scope="..." --test="..."
 *   node .cursor/scripts/operator/save-start-task-info.mjs --json='{"ticket":"IN-107113","plan":{...},"report":{...}}'
 *   node .cursor/scripts/operator/save-start-task-info.mjs --read [--ticket=IN-107113]
 *   node .cursor/scripts/operator/save-start-task-info.mjs --verify [--ticket=IN-107113]
 *   node .cursor/scripts/operator/save-start-task-info.mjs --update --ticket=IN-107113 --target="..."
 *
 * 參數說明：
 *   --ticket        Jira ticket 編號（可省略：會嘗試從目前分支名稱推導）
 *   --target        預期目標（plan.target）
 *   --scope         改動範圍（plan.scope）
 *   --test          驗收項目（plan.test）
 *   --json          完整的 JSON（可為 `{ plan, report }` 形狀；或舊形狀，會被轉為新形狀）
 *   --read          讀取目前的 JSON
 *   --verify        驗證 JSON 是否存在
 *   --update        合併更新（保留既有 report；覆寫 plan）
 */

import { execSync } from "child_process";
import { getProjectRoot } from "../utilities/env-loader.mjs";
import {
  createDefaultMergeRequestDescriptionInfoJson,
  ensureTmpDir,
  getMergeRequestDescriptionInfoJsonPath,
  normalizeMergeRequestDescriptionInfoJson,
  readJsonIfExists,
  toJiraTicketUrl,
  writeJsonFile,
} from "../cr/development-docs.mjs";

const projectRoot = getProjectRoot();

function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.silent) {
      console.error(`錯誤: ${error.message}`);
    }
    throw error;
  }
}

function getTicketFromCurrentBranch() {
  try {
    const branch = exec("git branch --show-current", { silent: true }).trim();
    const match = branch.match(/([A-Z0-9]+-\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getTicket(params) {
  const t =
    (typeof params.ticket === "string" && params.ticket.trim()) ||
    getTicketFromCurrentBranch();
  return t ? t.trim().toUpperCase() : null;
}

function readInfoJson(ticket) {
  if (!ticket) return null;
  const p = getMergeRequestDescriptionInfoJsonPath(ticket);
  const info = readJsonIfExists(p);
  if (!info) return null;
  return { path: p, info };
}

function verifyInfoJson(ticket) {
  const result = readInfoJson(ticket);
  if (!result) return { exists: false };
  return { exists: true, ticket, path: result.path };
}

// 解析命令行參數
function parseArgs(args) {
  const params = {
    read: false,
    verify: false,
    update: false,
    json: null,
    ticket: null,
    target: null,
    scope: null,
    test: null,
    // legacy args: accept but ignore (避免舊 command 直接壞掉)
    summary: null,
    type: null,
    status: null,
    assignee: null,
    priority: null,
    steps: null,
    sourceBranch: null,
    aiCompleted: null,
  };

  for (const arg of args) {
    if (arg === "--read") {
      params.read = true;
    } else if (arg === "--verify") {
      params.verify = true;
    } else if (arg === "--update") {
      params.update = true;
    } else if (arg.startsWith("--json=")) {
      params.json = arg.slice("--json=".length);
    } else if (arg.startsWith("--ticket=")) {
      params.ticket = arg.slice("--ticket=".length);
    } else if (arg.startsWith("--target=")) {
      params.target = arg.slice("--target=".length);
    } else if (arg.startsWith("--scope=")) {
      params.scope = arg.slice("--scope=".length);
    } else if (arg.startsWith("--test=")) {
      params.test = arg.slice("--test=".length);
    } else if (arg.startsWith("--summary=")) {
      params.summary = arg.slice("--summary=".length);
    } else if (arg.startsWith("--type=")) {
      params.type = arg.slice("--type=".length);
    } else if (arg.startsWith("--status=")) {
      params.status = arg.slice("--status=".length);
    } else if (arg.startsWith("--assignee=")) {
      params.assignee = arg.slice("--assignee=".length);
    } else if (arg.startsWith("--priority=")) {
      params.priority = arg.slice("--priority=".length);
    } else if (arg.startsWith("--steps=")) {
      params.steps = arg.slice("--steps=".length);
    } else if (arg.startsWith("--source-branch=")) {
      params.sourceBranch = arg.slice("--source-branch=".length);
    } else if (arg.startsWith("--ai-completed=")) {
      params.aiCompleted = arg.slice("--ai-completed=".length) === "true";
    }
  }

  return params;
}

function buildInfoJson(params, { ticket, existingInfo } = {}) {
  const jiraTicketUrl = toJiraTicketUrl(ticket);
  const base =
    (existingInfo && typeof existingInfo === "object" ? existingInfo : null) ||
    createDefaultMergeRequestDescriptionInfoJson({ ticket, jiraTicketUrl });

  let fromJson = null;
  if (params.json) {
    try {
      const parsed = JSON.parse(params.json);
      if (parsed && typeof parsed === "object") {
        fromJson = parsed;
      }
    } catch (error) {
      console.error(`❌ JSON 解析失敗: ${error.message}`);
      process.exit(1);
    }
  }

  const merged = normalizeMergeRequestDescriptionInfoJson(
    {
      ...base,
      ...(fromJson && typeof fromJson === "object" ? fromJson : null),
      ticket,
      jiraTicketUrl,
      plan: {
        ...(base?.plan && typeof base.plan === "object" ? base.plan : null),
        ...(fromJson?.plan && typeof fromJson.plan === "object"
          ? fromJson.plan
          : null),
        jiraTicketUrl,
        target:
          (typeof params.target === "string" && params.target.trim()) ||
          fromJson?.plan?.target ||
          base?.plan?.target ||
          "待補齊",
        scope:
          (typeof params.scope === "string" && params.scope.trim()) ||
          fromJson?.plan?.scope ||
          base?.plan?.scope ||
          "待補齊",
        test:
          (typeof params.test === "string" && params.test.trim()) ||
          fromJson?.plan?.test ||
          base?.plan?.test ||
          "待補齊",
      },
    },
    { changeFiles: [] }
  );

  return merged;
}

// 主函數
function main() {
  const args = process.argv.slice(2);
  const params = parseArgs(args);
  const ticket = getTicket(params);

  // 讀取模式
  if (params.read) {
    const result = readInfoJson(ticket);
    if (!result) {
      console.error("❌ 找不到 merge-request-description-info.json（請確認 ticket 或分支名稱）");
      process.exit(1);
    }
    console.log(JSON.stringify(result.info, null, 2));
    return;
  }

  // 驗證模式
  if (params.verify) {
    const result = verifyInfoJson(ticket);
    if (!result.exists) {
      console.log("❌ merge-request-description-info.json 不存在");
      process.exit(1);
    }
    console.log("✅ merge-request-description-info.json 存在");
    console.log(`   Ticket: ${result.ticket}`);
    console.log(`   Path: ${result.path}`);
    return;
  }

  const existingInfo = params.update ? readInfoJson(ticket)?.info || null : null;
  if (params.update && existingInfo) {
    console.log("📝 更新模式：將合併現有的 JSON\n");
  }

  // 檢查必要參數
  if (!ticket && !params.json) {
    console.log(`
📝 保存 Start-Task Info 工具

使用方式：
  node .cursor/scripts/operator/save-start-task-info.mjs --ticket=IN-107113 --target="..." --scope="..." --test="..."
  node .cursor/scripts/operator/save-start-task-info.mjs --json='{"ticket":"IN-107113","plan":{...},"report":{...}}'
  node .cursor/scripts/operator/save-start-task-info.mjs --read
  node .cursor/scripts/operator/save-start-task-info.mjs --verify
  node .cursor/scripts/operator/save-start-task-info.mjs --update --ticket=IN-107113 --target="..."

參數說明：
  --ticket        Jira ticket 編號（可省略：會嘗試從目前分支推導）
  --target        預期目標（plan.target）
  --scope         改動範圍（plan.scope）
  --test          驗收項目（plan.test）
  --json          完整的 JSON（可為 { plan, report } 形狀；或舊形狀，會被轉為新形狀）
  --read          讀取目前的 JSON
  --verify        驗證 JSON 是否存在
  --update        合併更新（保留既有 report；覆寫 plan）
`);
    process.exit(1);
  }

  const effectiveTicket =
    ticket ||
    (params.json ? (() => {
      try {
        const parsed = JSON.parse(params.json);
        return typeof parsed?.ticket === "string" ? parsed.ticket : null;
      } catch {
        return null;
      }
    })() : null);

  if (!effectiveTicket) {
    console.error("❌ 無法取得 ticket（請提供 --ticket 或確保分支名稱包含單號）");
    process.exit(1);
  }

  const infoJson = buildInfoJson(params, {
    ticket: effectiveTicket,
    existingInfo,
  });

  ensureTmpDir(effectiveTicket);
  const infoPath = getMergeRequestDescriptionInfoJsonPath(effectiveTicket);
  writeJsonFile(infoPath, infoJson);

  console.log("✅ 已保存 merge-request-description-info.json\n");
  console.log(JSON.stringify(infoJson, null, 2));
  console.log(`\n📍 Path: ${infoPath}`);

  console.log("\n🔍 驗證保存結果...");
  const verified = verifyInfoJson(effectiveTicket);
  if (!verified.exists) {
    console.error("❌ 驗證失敗：無法讀取剛保存的 JSON");
    process.exit(1);
  }
  console.log("✅ 驗證成功：JSON 已正確保存");
}

main();

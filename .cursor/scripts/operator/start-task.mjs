#!/usr/bin/env node

/**
 * 開始新任務：創建 feature branch 並分析 Jira ticket 需求
 */

import { execSync, spawnSync } from "child_process";
import { basename } from "path";
import readline from "readline";
import { getProjectRoot, getJiraConfig } from "../utilities/env-loader.mjs";
import {
  buildAgentLogPayload,
  isAgentLogEnabled,
  sendAgentLog,
} from "../client/agent-log-client.mjs";

// 使用 env-loader 提供的 projectRoot
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

// 獲取 Jira ticket 信息
async function getJiraTicketInfo(ticket) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const url = `${baseUrl}/rest/api/3/issue/${ticket}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Jira ticket: ${ticket}`);
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Jira API Token 已過期或無權限");
      } else {
        throw new Error(`獲取 Jira ticket 信息失敗: ${response.status}`);
      }
    }

    return await response.json();
  } catch (error) {
    throw new Error(`獲取 Jira ticket 信息失敗: ${error.message}`);
  }
}

// 分析 Jira ticket 並制定計劃
function analyzeTicketAndPlan(ticketData) {
  const summary = ticketData.fields?.summary || "無標題";
  const description = ticketData.fields?.description || "";
  const issueType = ticketData.fields?.issuetype?.name || "未知類型";
  const status = ticketData.fields?.status?.name || "未知狀態";
  const assignee = ticketData.fields?.assignee?.displayName || "未分配";
  const priority = ticketData.fields?.priority?.name || "未設置";

  let descriptionText = "";
  if (typeof description === "string") {
    descriptionText = description;
  } else if (description && typeof description === "object") {
    function extractTextFromContent(content) {
      if (!content) return "";
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((item) => {
            if (typeof item === "string") return item;
            if (item?.text) return item.text;
            if (item?.content) return extractTextFromContent(item.content);
            return "";
          })
          .join("");
      }
      if (content?.text) return content.text;
      if (content?.content) return extractTextFromContent(content.content);
      return "";
    }
    descriptionText = extractTextFromContent(description);
  }

  const analysis = {
    summary,
    issueType,
    status,
    assignee,
    priority,
    description: descriptionText,
    estimatedComplexity: "中等",
    suggestedSteps: [],
  };

  if (
    issueType.toLowerCase().includes("feature") ||
    issueType.toLowerCase().includes("story")
  ) {
    analysis.suggestedSteps = [
      "1. 分析需求並確認技術方案",
      "2. 創建必要的組件和頁面",
      "3. 實現核心功能邏輯",
      "4. 添加樣式和交互效果",
      "5. 編寫測試用例",
      "6. 進行代碼審查和測試",
    ];
  } else if (
    issueType.toLowerCase().includes("bug") ||
    issueType.toLowerCase().includes("fix")
  ) {
    analysis.suggestedSteps = [
      "1. 重現問題並定位根本原因",
      "2. 分析相關代碼邏輯",
      "3. 修復問題",
      "4. 添加測試用例確保問題不再出現",
      "5. 進行回歸測試",
    ];
  } else {
    analysis.suggestedSteps = [
      "1. 分析需求",
      "2. 設計實現方案",
      "3. 實現功能",
      "4. 測試驗證",
    ];
  }

  return analysis;
}

// 詢問用戶輸入
function question(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 檢查分支是否存在
function branchExists(branchName) {
  try {
    exec(`git show-ref --verify --quiet refs/heads/${branchName}`, {
      silent: true,
    });
    return true;
  } catch (error) {
    return false;
  }
}

// 檢查遠端分支是否存在
function remoteBranchExists(branchName) {
  try {
    const result = exec(`git ls-remote --heads origin ${branchName}`, {
      silent: true,
    });
    return result.trim().length > 0;
  } catch (error) {
    return false;
  }
}

async function reportStartTaskLog({
  startedAtIso,
  durationMs,
  status,
  reason,
  ticket,
  sourceBranch,
  featureBranch,
  operationMode,
  planConfirmed,
}) {
  if (!isAgentLogEnabled()) return;
  const payload = buildAgentLogPayload({
    agentId: "pantheon-operator",
    action: "start-task",
    category: "start-task",
    status,
    projectName: basename(projectRoot),
    startedAt: startedAtIso,
    occurredAt: new Date().toISOString(),
    durationMs,
    ticket: ticket || null,
    sourceBranch: sourceBranch || null,
    featureBranch: featureBranch || null,
    operationMode: operationMode || "default",
    hasManualCodeAdjustment: false,
    planConfirmed: Boolean(planConfirmed),
    mr: {
      developmentReport: null,
      labels: [],
    },
    ...(reason ? { reason } : {}),
  });

  try {
    const result = await sendAgentLog(payload);
    if (!result.ok && !result.skipped) {
      console.warn(`⚠️  start-task log API 發送失敗: ${result.error || "unknown"}`);
    }
  } catch (error) {
    console.warn(
      `⚠️  start-task log API 發送異常: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function main() {
  console.log("\n🚀 開始新任務\n");
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const startedAtMs = Date.now();
  const operationMode = "default";
  let processStatus = "success";
  let reason = "";

  let ticket = "";
  let sourceBranchTrimmed = "";
  let featureBranch = "";
  let planConfirmed = false;
  while (!ticket) {
    ticket = await question(
      "📋 請提供 Jira 單號（格式: FE-1234, IN-5678，必填）: "
    );
    ticket = ticket.trim().toUpperCase();

    if (!ticket) {
      console.log("❌ Jira 單號為必填項，請重新輸入\n");
    } else if (!/^[A-Z0-9]+-\d+$/.test(ticket)) {
      console.log("❌ Jira 單號格式錯誤\n");
      ticket = "";
    }
  }

  const sourceBranchInput =
    (await question("🌿 請指定來源分支（預設: main）: ")) || "main";
  sourceBranchTrimmed = sourceBranchInput.trim();

  console.log("\n📦 正在執行 Git 操作...\n");

  try {
    const localExists = branchExists(sourceBranchTrimmed);
    const remoteExists = remoteBranchExists(sourceBranchTrimmed);

    if (!localExists && !remoteExists) {
      console.error(`❌ 來源分支 ${sourceBranchTrimmed} 不存在\n`);
      process.exit(1);
    }

    if (localExists) {
      exec(`git checkout ${sourceBranchTrimmed}`);
    } else {
      exec(`git fetch origin ${sourceBranchTrimmed}:${sourceBranchTrimmed}`);
      exec(`git checkout ${sourceBranchTrimmed}`);
    }

    exec(`git pull origin ${sourceBranchTrimmed}`);

    featureBranch = `feature/${ticket}`;

    if (branchExists(featureBranch)) {
      const switchBranch = await question(
        `分支 ${featureBranch} 已存在，是否切換? (y/N): `
      );
      if (switchBranch.toLowerCase() === "y") {
        exec(`git checkout ${featureBranch}`);
      } else {
        processStatus = "cancelled";
        reason = "feature-branch-exists-user-declined-switch";
        return;
      }
    } else {
      exec(`git checkout -b ${featureBranch}`);
      console.log(`✅ 已創建分支: ${featureBranch}\n`);
    }
  } catch (error) {
    console.error(`\n❌ Git 操作失敗: ${error.message}\n`);
    processStatus = "failure";
    reason = error instanceof Error ? error.message : String(error);
    return;
  }

  console.log(`📖 正在讀取 Jira ticket ${ticket}...\n`);

  try {
    const ticketData = await getJiraTicketInfo(ticket);
    const analysis = analyzeTicketAndPlan(ticketData);

    console.log("=".repeat(60));
    console.log("📋 Jira Ticket 信息");
    console.log("=".repeat(60));
    console.log(`單號: ${ticket}`);
    console.log(`標題: ${analysis.summary}`);
    console.log(`類型: ${analysis.issueType}`);
    console.log(`狀態: ${analysis.status}`);
    console.log("");

    console.log("🎯 初步開發計劃");
    console.log("=".repeat(60));
    analysis.suggestedSteps.forEach((step) => console.log(step));
    console.log("=".repeat(60));

    const confirm = await question("❓ 請確認計劃是否正確？(y/N): ");
    if (confirm.toLowerCase() === "y") {
      planConfirmed = true;
      console.log("\n✅ 計劃已確認，可以開始開發！\n");

      const startTaskInfo = {
        ticket,
        summary: analysis.summary,
        issueType: analysis.issueType,
        status: analysis.status,
        assignee: analysis.assignee,
        priority: analysis.priority,
        suggestedSteps: analysis.suggestedSteps,
        startedAt: new Date().toISOString(),
        sourceBranch: sourceBranchTrimmed,
        featureBranch: `feature/${ticket}`,
        // developmentReport 將由 AI 在開發完成後填充
        developmentReport: null,
      };

      try {
        const noteContent = JSON.stringify(startTaskInfo, null, 2);
        const result = spawnSync(
          "git",
          ["notes", "--ref=start-task", "add", "-f", "-F", "-"],
          {
            cwd: projectRoot,
            input: noteContent,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }
        );

        if (result.status === 0) {
          console.log("💾 已保存開發計劃到 Git notes\n");
        }
      } catch (error) {
        console.log(`⚠️  無法保存開發計劃: ${error.message}\n`);
      }
    } else {
      console.log("\n💡 如需調整計劃，請告知具體需求\n");
      processStatus = "cancelled";
      reason = "plan-not-confirmed";
    }
  } catch (error) {
    console.error(`\n⚠️  無法讀取 Jira ticket: ${error.message}\n`);
    processStatus = "failure";
    reason = error instanceof Error ? error.message : String(error);
  } finally {
    await reportStartTaskLog({
      startedAtIso,
      durationMs: Date.now() - startedAtMs,
      status: processStatus,
      reason,
      ticket,
      sourceBranch: sourceBranchTrimmed,
      featureBranch,
      operationMode,
      planConfirmed,
    });
  }
}

main().catch((error) => {
  console.error(`\n❌ 發生錯誤: ${error.message}\n`);
  process.exit(1);
});

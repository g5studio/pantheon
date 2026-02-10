#!/usr/bin/env node

/**
 * 開始新任務：創建 feature branch 並分析 Jira ticket 需求
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import readline from "readline";
import { getProjectRoot, getJiraConfig } from "../utilities/env-loader.mjs";

// 使用 env-loader 提供的 projectRoot
const projectRoot = getProjectRoot();

const TMP_ROOT = join(projectRoot, ".cursor", "tmp");

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

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function buildDevelopmentPlanTemplate({ ticket, summary, issueType }) {
  // 只提供模板骨架，讓後續 start-task 擴充可以自行填內容
  return [
    "## 🎯 開發計劃",
    "",
    `- Ticket: ${ticket}`,
    `- Summary: ${summary}`,
    `- Issue Type: ${issueType}`,
    "",
    "### Steps",
    "",
    "- [ ] step 1",
    "- [ ] step 2",
    "- [ ] step 3",
    "",
  ].join("\n");
}

function buildDevelopmentReportTemplate({ ticket, summary, issueType }) {
  // 對齊 create-mr 的開發報告格式驗證（關聯單資訊、變更摘要、變更內容表格、風險評估表格）
  return [
    "## 📋 關聯單資訊",
    "",
    "| 項目 | 值 |",
    "|---|---|",
    `| **單號** | [${ticket}](https://innotech.atlassian.net/browse/${ticket}) |`,
    `| **標題** | ${summary} |`,
    `| **類型** | ${issueType} |`,
    "",
    "---",
    "",
    "## 📝 變更摘要",
    "",
    "<請填寫本次變更目的與摘要>",
    "",
    "### 變更內容",
    "",
    "| 檔案 | 狀態 | 說明 |",
    "|---|---|---|",
    "| `path/to/file` | 更新 | <說明> |",
    "",
    "---",
    "",
    "## ⚠️ 風險評估",
    "",
    "| 檔案 | 風險等級 | 評估說明 |",
    "|---|---|---|",
    "| `path/to/file` | 輕度 | <說明> |",
    "",
  ].join("\n");
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

async function main() {
  console.log("\n🚀 開始新任務\n");

  let ticket = "";
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

  const sourceBranch =
    (await question("🌿 請指定來源分支（預設: main）: ")) || "main";
  const sourceBranchTrimmed = sourceBranch.trim();

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

    const featureBranch = `feature/${ticket}`;

    if (branchExists(featureBranch)) {
      const switchBranch = await question(
        `分支 ${featureBranch} 已存在，是否切換? (y/N): `
      );
      if (switchBranch.toLowerCase() === "y") {
        exec(`git checkout ${featureBranch}`);
      } else {
        process.exit(0);
      }
    } else {
      exec(`git checkout -b ${featureBranch}`);
      console.log(`✅ 已創建分支: ${featureBranch}\n`);
    }
  } catch (error) {
    console.error(`\n❌ Git 操作失敗: ${error.message}\n`);
    process.exit(1);
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
      console.log("\n✅ 計劃已確認，可以開始開發！\n");

      // 產出實體檔案到 .cursor/tmp/<ticket>/（避免污染其他 ticket）
      const taskDir = join(TMP_ROOT, ticket);
      ensureDir(taskDir);

      const startTaskInfoFile = join(taskDir, "start-task-info.json");
      const developmentPlanFile = join(taskDir, "development-plan.md");
      const developmentReportFile = join(taskDir, "development-report.md");

      // 寫入 plan / report 模板
      writeFileSync(
        developmentPlanFile,
        buildDevelopmentPlanTemplate({
          ticket,
          summary: analysis.summary,
          issueType: analysis.issueType,
        }),
        "utf-8"
      );
      writeFileSync(
        developmentReportFile,
        buildDevelopmentReportTemplate({
          ticket,
          summary: analysis.summary,
          issueType: analysis.issueType,
        }),
        "utf-8"
      );

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
        // 檔案化產物路徑（供 create-mr / update-mr 透過參數串接）
        developmentPlanFile,
        developmentReportFile,
        aiDevelopmentPlan: true,
        aiDevelopmentReport: true,
        // Gate 欄位：create-mr 會在 rebase/push 前檢查（同 ticket 才生效）
        planConfirmed: true,
        resultVerified: false,
        updatedAt: new Date().toISOString(),
      };

      writeFileSync(startTaskInfoFile, JSON.stringify(startTaskInfo, null, 2), {
        encoding: "utf-8",
      });

      console.log("💾 已建立 start-task 暫存檔案（檔案化，不使用 Git notes）\n");
      console.log(`   - ${startTaskInfoFile}`);
      console.log(`   - ${developmentPlanFile}`);
      console.log(`   - ${developmentReportFile}\n`);

      console.log("ℹ️  後續對接 create-mr / update-mr 時，可傳入以下參數：");
      console.log(`   --start-task-info-file="${startTaskInfoFile}"`);
      console.log(`   --development-plan-file="${developmentPlanFile}"`);
      console.log(`   --development-report-file="${developmentReportFile}"\n`);
    } else {
      console.log("\n💡 如需調整計劃，請告知具體需求\n");
    }
  } catch (error) {
    console.error(`\n⚠️  無法讀取 Jira ticket: ${error.message}\n`);
  }
}

main().catch((error) => {
  console.error(`\n❌ 發生錯誤: ${error.message}\n`);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * 使用 GitLab API 建立 Merge Request
 * 支持使用 GitLab CLI (glab) 或 API token
 */

import { execSync, spawnSync } from "child_process";
import { join } from "path";
import readline from "readline";
import { readFileSync, existsSync } from "fs";
import {
  getProjectRoot,
  loadEnvLocal,
  getJiraConfig,
  guideJiraConfig,
  getGitLabToken,
  getJiraEmail,
  getCompassApiToken,
  getMRReviewer,
} from "../utilities/env-loader.mjs";
import {
  determineLabels,
  getJiraFixVersion,
  extractVersionLabel,
  isHotfixVersion,
  extractReleaseBranch,
  readStartTaskInfo,
} from "./label-analyzer.mjs";

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

// 檢查是否安裝了 glab
function hasGlab() {
  try {
    exec("which glab", { silent: true });
    return true;
  } catch (error) {
    return false;
  }
}

// 檢查 SSH 是否已配置
function isSSHConfigured(hostname) {
  try {
    const result = exec(`ssh -T git@${hostname}`, { silent: true });
    return (
      result.includes("Welcome to GitLab") || result.includes("authenticated")
    );
  } catch (error) {
    return false;
  }
}

// 檢查 glab 是否已登入
function isGlabAuthenticated(hostname) {
  try {
    const result = exec(`glab auth status --hostname ${hostname}`, {
      silent: true,
    });
    return result.includes("authenticated") || result.includes("✓");
  } catch (error) {
    return false;
  }
}

// 使用 token 登入 glab
function loginGlabWithToken(hostname, token, useSSH = true) {
  const args = ["auth", "login", "--hostname", hostname, "--token", token];

  if (useSSH) {
    args.push("--git-protocol", "ssh");
  }

  try {
    const result = spawnSync("glab", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`glab 登入失敗，退出碼: ${result.status}`);
    }

    return true;
  } catch (error) {
    throw new Error(`glab 登入失敗: ${error.message}`);
  }
}

// 從用戶輸入獲取 token
function getTokenFromUser() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n📝 請輸入你的 GitLab Personal Access Token");
    console.log(
      "   獲取 token: https://gitlab.service-hub.tech/-/user_settings/personal_access_tokens"
    );
    console.log("   需要的權限: api, write_repository\n");

    console.log("💡 如何獲取 Token：");
    console.log(
      "   1. 前往: https://gitlab.service-hub.tech/-/user_settings/personal_access_tokens"
    );
    console.log('   2. 點擊 "Add new token"');
    console.log('   3. 填寫 Token name（例如: "glab-cli"）');
    console.log("   4. 選擇 Expiration date（可選）");
    console.log("   5. 勾選權限: api, write_repository");
    console.log('   6. 點擊 "Create personal access token"');
    console.log("   7. 複製生成的 token（只會顯示一次）\n");

    console.log("💡 提示：");
    console.log("   - 如果想永久保存 token，可以執行:");
    console.log('     git config --global gitlab.token "YOUR_TOKEN"');
    console.log("   - 或設置環境變數:");
    console.log('     export GITLAB_TOKEN="YOUR_TOKEN"');
    console.log("   - 設置後，之後就不需要每次都輸入 token 了\n");

    rl.question("Token: ", (token) => {
      rl.close();
      resolve(token.trim());
    });
  });
}

// 查找當前分支的現有 MR
async function findExistingMR(token, host, projectPath, sourceBranch) {
  try {
    const url = `${host}/api/v4/projects/${projectPath}/merge_requests?source_branch=${encodeURIComponent(
      sourceBranch
    )}&state=opened`;
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": token,
      },
    });

    if (!response.ok) {
      return null;
    }

    const mrs = await response.json();
    return mrs.length > 0 ? mrs[0] : null;
  } catch (error) {
    return null;
  }
}

// 使用 glab 查找現有 MR
function findExistingMRWithGlab(sourceBranch) {
  try {
    const result = exec(
      "glab mr list --source-branch " + sourceBranch + " --state opened",
      { silent: true }
    );
    const match = result.match(/!(\d+)/);
    if (match) {
      return match[1];
    }
    return null;
  } catch (error) {
    return null;
  }
}

// 使用 glab 獲取現有 MR 的完整信息（包括 reviewer）
function getMRDetailsWithGlab(mrId) {
  try {
    const result = exec(`glab mr view ${mrId} --json`, { silent: true });
    if (result && result.trim()) {
      return JSON.parse(result);
    }
    return null;
  } catch (error) {
    return null;
  }
}

// 使用 API 獲取現有 MR 的完整信息（包括 reviewer）
async function getMRDetails(token, host, projectPath, mrIid) {
  try {
    const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": token,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

// 使用 glab 更新 MR
function updateMRWithGlab(
  mrId,
  title,
  description,
  draft,
  reviewer,
  labels = [],
  shouldUpdateReviewer = true
) {
  const args = ["mr", "update", mrId];

  // CRITICAL: 已存在的 MR title 不可異動，不更新 title

  if (description) {
    args.push("--description", description);
  }

  if (draft) {
    args.push("--draft");
  } else {
    args.push("--ready");
  }

  // CRITICAL: 只有在 shouldUpdateReviewer 為 true 時才更新 reviewer
  if (shouldUpdateReviewer && reviewer) {
    args.push("--reviewer", reviewer);
  }

  if (labels && labels.length > 0) {
    args.push("--label", labels.join(","));
  }

  args.push("--remove-source-branch");

  try {
    const result = spawnSync("glab", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`glab 退出碼: ${result.status}`);
    }

    if (result.stdout) {
      console.log(result.stdout);
    }

    return result.stdout || "";
  } catch (error) {
    throw new Error(`glab 更新失敗: ${error.message}`);
  }
}

// 使用 glab 建立 MR
function createMRWithGlab(
  sourceBranch,
  targetBranch,
  title,
  description,
  draft,
  reviewer,
  assignee,
  labels = []
) {
  const args = [
    "mr",
    "create",
    "--source-branch",
    sourceBranch,
    "--target-branch",
    targetBranch,
    "--title",
    draft ? `Draft: ${title}` : title,
    "--description",
    description,
    "--remove-source-branch",
  ];

  if (draft) {
    args.push("--draft");
  }

  if (assignee) {
    args.push("--assignee", assignee);
  }

  if (reviewer) {
    args.push("--reviewer", reviewer);
  }

  if (labels && labels.length > 0) {
    args.push("--label", labels.join(","));
  }

  args.push("--remove-source-branch");

  try {
    const result = spawnSync("glab", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`glab 退出碼: ${result.status}`);
    }

    if (result.stdout) {
      console.log(result.stdout);
    }

    return result.stdout || "";
  } catch (error) {
    throw new Error(`glab 執行失敗: ${error.message}`);
  }
}

// 獲取項目信息
function getProjectInfo() {
  const remoteUrl = exec("git config --get remote.origin.url", {
    silent: true,
  }).trim();

  if (remoteUrl.startsWith("git@")) {
    const match = remoteUrl.match(/git@([^:]+):(.+)/);
    if (match) {
      const [, host, path] = match;
      const projectPath = path.replace(/\.git$/, "").replace(/\//g, "%2F");
      return {
        host: `https://${host}`,
        projectPath: encodeURIComponent(path.replace(/\.git$/, "")),
        fullPath: path.replace(/\.git$/, ""),
      };
    }
  }

  if (remoteUrl.startsWith("https://")) {
    const url = new URL(remoteUrl);
    const pathParts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    const projectPath = pathParts.join("%2F");
    return {
      host: `${url.protocol}//${url.host}`,
      projectPath,
      fullPath: pathParts.join("/"),
    };
  }

  throw new Error("無法解析 remote URL");
}

// 獲取當前分支
function getCurrentBranch() {
  return exec("git rev-parse --abbrev-ref HEAD", { silent: true }).trim();
}

// 獲取 git 狀態（未提交的變更）
function getGitStatus() {
  try {
    const status = exec("git status --porcelain", { silent: true });
    return status
      .trim()
      .split("\n")
      .filter((line) => line.trim());
  } catch (error) {
    return [];
  }
}

// 獲取未推送的 commits
function getUnpushedCommits(branch) {
  try {
    const result = exec(`git log origin/${branch}..HEAD --oneline`, {
      silent: true,
    });
    return result
      .trim()
      .split("\n")
      .filter((line) => line.trim());
  } catch (error) {
    return [];
  }
}

// 推送 commits 到遠端
function pushToRemote(branch, forceWithLease = false) {
  try {
    const forceFlag = forceWithLease ? " --force-with-lease" : "";
    console.log(
      `🚀 正在推送 commits 到 origin/${branch}${
        forceWithLease ? "（force-with-lease）" : ""
      }...`
    );
    exec(`git push origin ${branch}${forceFlag}`, { silent: false });
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 執行 rebase 到目標分支
function rebaseToTargetBranch(targetBranch) {
  console.log(`\n🔄 正在 rebase 到目標分支 ${targetBranch}...\n`);

  console.log(`📥 正在 fetch origin/${targetBranch}...`);
  try {
    exec(`git fetch origin ${targetBranch}`, { silent: false });
    console.log(`✅ fetch 完成\n`);
  } catch (error) {
    return {
      success: false,
      error: `無法 fetch 目標分支 ${targetBranch}: ${error.message}`,
      hasConflict: false,
    };
  }

  console.log(`🔀 正在執行 git rebase origin/${targetBranch}...`);
  try {
    exec(`git rebase origin/${targetBranch}`, { silent: false });
    console.log(`\n✅ Rebase 成功！\n`);
    return { success: true, error: null, hasConflict: false };
  } catch (error) {
    try {
      const status = exec("git status --porcelain", { silent: true });
      const hasConflict =
        status.includes("UU ") ||
        status.includes("AA ") ||
        status.includes("DD ") ||
        status.includes("AU ") ||
        status.includes("UA ") ||
        status.includes("DU ") ||
        status.includes("UD ");

      if (hasConflict) {
        return {
          success: false,
          error: `Rebase 過程中發生衝突`,
          hasConflict: true,
        };
      }
    } catch (statusError) {
      // 無法檢查狀態
    }

    return {
      success: false,
      error: `Rebase 失敗: ${error.message}`,
      hasConflict: false,
    };
  }
}

// 檢查是否正在進行 rebase
function isRebaseInProgress() {
  try {
    const gitDir = exec("git rev-parse --git-dir", { silent: true }).trim();
    const rebaseMergeExists = existsSync(
      join(projectRoot, gitDir, "rebase-merge")
    );
    const rebaseApplyExists = existsSync(
      join(projectRoot, gitDir, "rebase-apply")
    );
    return rebaseMergeExists || rebaseApplyExists;
  } catch (error) {
    return false;
  }
}

// 重命名分支（本地和遠端）
async function renameBranch(oldBranch, newBranch) {
  try {
    try {
      const existingBranch = exec(`git rev-parse --verify ${newBranch}`, {
        silent: true,
      });
      if (existingBranch) {
        throw new Error(`分支 ${newBranch} 已存在`);
      }
    } catch (error) {
      if (!error.message.includes("fatal: not a valid object name")) {
        throw error;
      }
    }

    console.log(`🔄 正在重命名本地分支: ${oldBranch} -> ${newBranch}`);
    exec(`git branch -m ${oldBranch} ${newBranch}`);

    let remoteExists = false;
    try {
      const result = exec(`git ls-remote --heads origin ${oldBranch}`, {
        silent: true,
      });
      remoteExists = result && result.trim().length > 0;
    } catch (error) {
      remoteExists = false;
    }

    if (remoteExists) {
      console.log(`🔄 正在更新遠端分支...`);
      try {
        exec(`git push origin :${oldBranch}`, { silent: true });
      } catch (error) {
        console.log(`⚠️  無法刪除遠端舊分支，將只推送新分支`);
      }
      exec(`git push origin ${newBranch}`, { silent: true });
      exec(`git branch --set-upstream-to=origin/${newBranch} ${newBranch}`, {
        silent: true,
      });
      console.log(`✅ 已更新遠端分支\n`);
    } else {
      console.log(`ℹ️  遠端分支 ${oldBranch} 不存在，只推送新分支`);
      exec(`git push origin ${newBranch}`, { silent: true });
      exec(`git branch --set-upstream-to=origin/${newBranch} ${newBranch}`, {
        silent: true,
      });
      console.log(`✅ 已推送新分支\n`);
    }

    return true;
  } catch (error) {
    throw new Error(`重命名分支失敗: ${error.message}`);
  }
}

// 檢查是否為 feature branch
function isFeatureBranch(branchName) {
  return /^(fix|feat|feature)\//.test(branchName);
}

// 從用戶輸入獲取正確的單號
function getCorrectTicketFromUser(oldTicket) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(`\n❌ 分支中使用的單號 ${oldTicket} 在 Jira 中不存在\n`);
    console.log("💡 請提供正確的單號（格式：FE-1234 或 IN-1234）\n");

    rl.question("正確的單號: ", (newTicket) => {
      rl.close();
      const trimmedTicket = newTicket.trim();
      if (!trimmedTicket.match(/^(FE|IN)-\d+$/)) {
        console.error(`\n❌ 單號格式不正確，應為 FE-1234 或 IN-1234 格式\n`);
        process.exit(1);
      }
      resolve(trimmedTicket);
    });
  });
}

// 獲取最近的 commit message
function getLastCommitMessage() {
  return exec("git log -1 --pretty=%B", { silent: true }).trim();
}

// 獲取 commit message 的 subject（第一行）
function getLastCommitSubject() {
  return exec("git log -1 --pretty=%s", { silent: true }).trim();
}

// 檢查 Jira ticket 是否存在
async function checkJiraTicketExists(ticket) {
  if (!ticket || ticket === "N/A") {
    return { exists: false, error: null };
  }

  let config;
  try {
    config = getJiraConfig();
  } catch (error) {
    return { exists: false, error: error.message };
  }

  if (!config || !config.email || !config.apiToken) {
    return { exists: false, error: "Jira API 認證信息未設置" };
  }

  try {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    );
    const baseUrl = config.baseUrl.endsWith("/")
      ? config.baseUrl.slice(0, -1)
      : config.baseUrl;
    const url = `${baseUrl}/rest/api/3/issue/${ticket}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { exists: false, error: null };
      } else if (response.status === 401 || response.status === 403) {
        return {
          exists: false,
          error: "Jira API Token 已過期或無權限，請聯繫 william.chiang",
        };
      } else {
        return {
          exists: false,
          error: `獲取 Jira ticket 信息失敗: ${response.status} ${response.statusText}`,
        };
      }
    }

    return { exists: true, error: null };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

// 從 description 中提取 Jira ticket 號碼
function extractJiraTickets(description) {
  if (!description) return [];

  const ticketPattern = /([A-Z0-9]+-\d+)/g;
  const matches = description.match(ticketPattern);

  if (!matches) return [];

  return [...new Set(matches)].sort();
}

// 生成 Jira ticket 的短連結
function generateJiraLink(ticket) {
  return `https://innotech.atlassian.net/browse/${ticket}`;
}

// 格式化 Jira tickets 為超連結格式（Markdown）
function formatJiraTicketsAsLinks(tickets) {
  if (!tickets || tickets.length === 0) return "";

  const links = tickets.map(
    (ticket) => `[${ticket}](${generateJiraLink(ticket)})`
  );
  return links.join(" , ");
}

// 獲取 GitLab user email
async function getGitLabUserEmail(hostname = "gitlab.service-hub.tech") {
  if (hasGlab() && isGlabAuthenticated(hostname)) {
    try {
      const result = exec("glab api user", { silent: true });
      if (result && result.trim()) {
        const userInfo = JSON.parse(result);
        if (userInfo && userInfo.email) {
          return userInfo.email;
        }
      }
    } catch (error) {
      // glab 獲取失敗
    }
  }

  try {
    const token = getGitLabToken();
    if (token) {
      const response = await fetch(`https://${hostname}/api/v4/user`, {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      });

      if (response.ok) {
        const userInfo = await response.json();
        if (userInfo && userInfo.email) {
          return userInfo.email;
        }
      }
    }
  } catch (error) {
    // API 獲取失敗
  }

  return null;
}

// 獲取當前 GitLab 用戶 ID
async function getGitLabUserId(hostname = "gitlab.service-hub.tech") {
  if (hasGlab() && isGlabAuthenticated(hostname)) {
    try {
      const result = exec("glab api user", { silent: true });
      if (result && result.trim()) {
        const userInfo = JSON.parse(result);
        if (userInfo && userInfo.id) {
          return userInfo.id;
        }
      }
    } catch (error) {
      // glab 獲取失敗
    }
  }

  try {
    const token = getGitLabToken();
    if (token) {
      const response = await fetch(`https://${hostname}/api/v4/user`, {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      });

      if (response.ok) {
        const userInfo = await response.json();
        if (userInfo && userInfo.id) {
          return userInfo.id;
        }
      }
    }
  } catch (error) {
    // API 獲取失敗
  }

  return null;
}

// 獲取 Jira ticket 的 title
async function getJiraTicketTitle(ticket) {
  try {
    const config = getJiraConfig();
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    );
    const baseUrl = config.baseUrl.endsWith("/")
      ? config.baseUrl.slice(0, -1)
      : config.baseUrl;
    const url = `${baseUrl}/rest/api/3/issue/${ticket}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const ticketData = await response.json();
    return ticketData.fields?.summary || null;
  } catch (error) {
    return null;
  }
}

// 檢查必要的配置（用於 AI review）
function checkAndGuideConfigForAIReview() {
  const missingConfigs = [];
  const guides = [];

  const compassApiToken = getCompassApiToken();
  if (!compassApiToken) {
    missingConfigs.push("Compass API Token");
    guides.push({
      name: "Compass API Token",
      steps: [
        "1. 打開 compass 站台",
        "2. 點擊右上角頭像",
        "3. 選 personal tokens",
        "4. 建立 token",
        "5. 在 .env.local 文件中添加:",
        "   COMPASS_API_TOKEN=your-token-here",
        "6. 或設置環境變數:",
        "   export COMPASS_API_TOKEN=your-token-here",
      ],
    });
  }

  try {
    const gitlabToken = getGitLabToken();
    const isGlabAuth =
      hasGlab() && isGlabAuthenticated("gitlab.service-hub.tech");

    if (!gitlabToken && !isGlabAuth) {
      missingConfigs.push("GitLab Token");
      guides.push({
        name: "GitLab Token",
        steps: [
          "1. 前往: https://gitlab.service-hub.tech/-/user_settings/personal_access_tokens",
          '2. 點擊 "Add new token"',
          '3. 填寫 Token name（例如: "glab-cli"）',
          "4. 勾選權限: api, write_repository",
          '5. 點擊 "Create personal access token"',
          "6. 複製生成的 token",
          "7. 執行以下命令之一：",
          '   - git config --global gitlab.token "YOUR_TOKEN"',
          '   - export GITLAB_TOKEN="YOUR_TOKEN"',
          "   或在 .env.local 文件中添加: GITLAB_TOKEN=YOUR_TOKEN",
          "   或執行: glab auth login --hostname gitlab.service-hub.tech",
        ],
      });
    }
  } catch (error) {
    if (!missingConfigs.includes("GitLab Token")) {
      missingConfigs.push("GitLab Token");
    }
  }

  const jiraEmail = getJiraEmail();
  if (!jiraEmail) {
    if (missingConfigs.length > 0) {
      missingConfigs.push("Jira Email（備用）");
      guides.push({
        name: "Jira Email（備用方案）",
        steps: [
          "1. 在 .env.local 文件中添加:",
          "   JIRA_EMAIL=your-email@example.com",
          "2. 或設置環境變數:",
          "   export JIRA_EMAIL=your-email@example.com",
        ],
      });
    }
  }

  if (missingConfigs.length > 0) {
    console.error(
      `\n❌ 缺少以下配置（AI review 需要）: ${missingConfigs.join(", ")}\n`
    );
    console.error("📝 請按照以下步驟設置：\n");

    guides.forEach((guide) => {
      console.error(`**${guide.name}:**`);
      guide.steps.forEach((step) => {
        console.error(`   ${step}`);
      });
      console.error("");
    });

    console.error("💡 提示：設置完成後，請重新執行命令。\n");
    return false;
  }

  return true;
}

// 獲取 AI review 提交時使用的 email
async function getAIReviewEmail() {
  const gitlabEmail = await getGitLabUserEmail();
  if (gitlabEmail) {
    return gitlabEmail;
  }

  const jiraEmail = getJiraEmail();
  if (jiraEmail) {
    return jiraEmail;
  }

  console.error("\n❌ 無法獲取 email 用於 AI review 提交\n");
  console.error("📝 請設置以下配置之一：\n");
  console.error("**方法 1: 設置 GitLab Token（推薦）**");
  console.error(
    "   1. 前往: https://gitlab.service-hub.tech/-/user_settings/personal_access_tokens"
  );
  console.error(
    '   2. 創建 token 並設置: git config --global gitlab.token "YOUR_TOKEN"'
  );
  console.error(
    "   或執行: glab auth login --hostname gitlab.service-hub.tech\n"
  );
  console.error("**方法 2: 設置 Jira Email**");
  console.error(
    "   在 .env.local 文件中添加: JIRA_EMAIL=your-email@example.com\n"
  );
  console.error("💡 設置完成後，請重新執行命令。\n");

  return null;
}

// 提交 AI review
async function submitAIReview(mrUrl) {
  if (!checkAndGuideConfigForAIReview()) {
    throw new Error(
      "配置不完整，請先設置必要的配置（Compass API token、GitLab token 或 Jira email）"
    );
  }

  const apiKey = getCompassApiToken();
  if (!apiKey) {
    throw new Error("無法獲取 Compass API token，請設置 COMPASS_API_TOKEN");
  }

  const email = await getAIReviewEmail();
  if (!email) {
    throw new Error("無法獲取 email，請設置 GitLab token 或 Jira email");
  }

  console.log(`📧 使用 email: ${email} 提交 AI review`);

  const apiUrl =
    "https://mac09demac-mini.balinese-python.ts.net/api/workflows/jobs";

  const requestBody = {
    taskId: "code-review",
    version: "v1",
    input: {
      mergeRequestUrl: mrUrl,
      email: email,
      llm: {
        provider: "openai",
        model: "gpt-5-2025-08-07",
      },
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI review API 請求失敗: ${response.status} ${errorText}`
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`提交 AI review 失敗: ${error.message}`);
  }
}

// 更新 MR
async function updateMR(
  token,
  host,
  projectPath,
  mrIid,
  title,
  description,
  draft,
  reviewerId,
  labels = [],
  shouldUpdateReviewer = true
) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;

  const body = {};

  // CRITICAL: 已存在的 MR title 不可異動

  if (description) {
    body.description = description;
  }

  body.work_in_progress = draft;

  if (shouldUpdateReviewer && reviewerId) {
    body.reviewer_ids = [reviewerId];
  }

  if (labels && labels.length > 0) {
    body.add_labels = labels.join(",");
  }

  body.remove_source_branch = true;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(JSON.stringify(error, null, 2));
    }

    return await response.json();
  } catch (error) {
    throw new Error(`更新 MR 失敗: ${error.message}`);
  }
}

// 建立 MR
async function createMR(
  token,
  host,
  projectPath,
  sourceBranch,
  targetBranch,
  title,
  description,
  draft,
  reviewerId,
  assigneeId,
  labels = []
) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests`;

  const body = {
    source_branch: sourceBranch,
    target_branch: targetBranch,
    title: draft ? `Draft: ${title}` : title,
    description,
    work_in_progress: draft,
    remove_source_branch: true,
  };

  if (assigneeId) {
    body.assignee_id = assigneeId;
  }

  if (reviewerId) {
    body.reviewer_ids = [reviewerId];
  }

  if (labels && labels.length > 0) {
    body.labels = labels.join(",");
  }

  body.remove_source_branch = true;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      if (error.message && Array.isArray(error.message)) {
        const existingMRMatch = error.message[0]?.match(/!(\d+)/);
        if (existingMRMatch) {
          const existingMRId = existingMRMatch[1];
          throw new Error(
            `已存在 MR !${existingMRId}。請更新現有 MR 或關閉後再建立新的 MR。\n現有 MR: ${host}/frontend/fluid-two/-/merge_requests/${existingMRId}`
          );
        }
      }
      throw new Error(JSON.stringify(error, null, 2));
    }

    return await response.json();
  } catch (error) {
    throw new Error(`建立 MR 失敗: ${error.message}`);
  }
}

// 查找用戶 ID
async function findUserId(token, host, username) {
  try {
    const cleanUsername = username.replace(/^@/, "");

    const response = await fetch(
      `${host}/api/v4/users?username=${encodeURIComponent(cleanUsername)}`,
      {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const users = await response.json();
    if (users.length > 0) {
      return users[0].id;
    }

    return null;
  } catch (error) {
    console.error(`查找用戶失敗: ${error.message}`);
    return null;
  }
}

// 生成開發計劃區塊（純開發步驟，不含關聯單資訊）
function generateDevelopmentPlanSection(taskInfo) {
  if (!taskInfo) return null;

  // 支持多種開發計劃格式
  // 格式 1: 傳統 start-task 格式（suggestedSteps）
  // 格式 2: 外部傳入的自定義格式
  const steps = taskInfo.suggestedSteps || taskInfo.steps || [];

  if (steps.length === 0) {
    return null;
  }

  const planSection = [
    "## 🎯 開發計劃",
    "",
    taskInfo.description ||
      "本 MR 由 `start-task` 命令啟動，以下是初步制定的開發計劃：",
    "",
    ...steps.map((step) => `- ${step}`),
  ];

  return planSection.join("\n");
}

// 生成關聯單資訊區塊（僅包含單號、標題、類型）
function generateRelatedTicketsSection(taskInfo) {
  if (!taskInfo) return null;

  // 檢查是否有任何關聯單資訊
  const hasTicketInfo =
    taskInfo.ticket || taskInfo.summary || taskInfo.issueType;

  if (!hasTicketInfo) {
    return null;
  }

  const sections = ["## 📋 關聯單資訊", "", "| 項目 | 值 |", "|---|---|"];

  if (taskInfo.ticket) {
    const ticketUrl = `https://innotech.atlassian.net/browse/${taskInfo.ticket}`;
    sections.push(`| **單號** | [${taskInfo.ticket}](${ticketUrl}) |`);
  }
  if (taskInfo.summary) {
    sections.push(`| **標題** | ${taskInfo.summary} |`);
  }
  if (taskInfo.issueType) {
    sections.push(`| **類型** | ${taskInfo.issueType} |`);
  }

  return sections.join("\n");
}

// 解析外部傳入的開發計劃
// 支持兩種格式：
// 1. JSON 對象格式（包含 steps/suggestedSteps 欄位，會走格式化流程）
// 2. 純字符串或其他格式（直接作為完整的開發計劃內容使用，存入 raw 欄位）
function parseExternalDevelopmentPlan(planArg) {
  if (!planArg) return null;

  try {
    // 嘗試解析為 JSON
    const parsed = JSON.parse(planArg);
    // 如果是對象且有 steps 或 suggestedSteps 欄位，返回對象以走格式化流程
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed.steps || parsed.suggestedSteps)
    ) {
      return parsed;
    }
    // 如果是字符串，作為 raw 內容直接使用
    if (typeof parsed === "string") {
      return { raw: parsed };
    }
    // 其他情況（如純對象），轉為格式化字符串作為 raw 使用
    return { raw: JSON.stringify(parsed, null, 2) };
  } catch (error) {
    // JSON 解析失敗，視為純字符串，直接作為 raw 內容使用
    return { raw: planArg };
  }
}

// 解析外部傳入的 Agent 版本資訊
function parseAgentVersion(versionArg) {
  if (!versionArg) return null;

  try {
    // 嘗試解析為 JSON
    const parsed = JSON.parse(versionArg);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
    return null;
  } catch (error) {
    // JSON 解析失敗
    console.log(`⚠️  Agent 版本資訊格式錯誤，跳過版本顯示`);
    return null;
  }
}

// 生成 Agent 版本資訊區塊
function generateAgentVersionSection(versionInfo) {
  if (!versionInfo || Object.keys(versionInfo).length === 0) {
    return null;
  }

  const lines = [
    "---",
    "",
    "### 🤖 Agent Version",
    "",
    "| Deity Agent | Version |",
    "|-------------|---------|",
  ];

  for (const [component, version] of Object.entries(versionInfo)) {
    lines.push(`| ${component} | ${version} |`);
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const targetBranchArg = args.find((arg) => arg.startsWith("--target="));
  const userExplicitlySetTarget = !!targetBranchArg;
  let targetBranch = targetBranchArg?.split("=")[1] || "main";
  const draft = !args.includes("--no-draft");

  // 解析外部傳入的開發計劃
  const developmentPlanArg = args.find((arg) =>
    arg.startsWith("--development-plan=")
  );
  const externalDevelopmentPlan = developmentPlanArg
    ? parseExternalDevelopmentPlan(
        developmentPlanArg.split("=").slice(1).join("=")
      )
    : null;

  // 解析外部傳入的 labels（支持逗號分隔）
  const externalLabelsArg = args.find((arg) => arg.startsWith("--labels="));
  const externalLabels = externalLabelsArg
    ? externalLabelsArg
        .split("=")
        .slice(1)
        .join("=")
        .split(",")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : [];

  // 解析外部傳入的 Agent 版本資訊
  const agentVersionArg = args.find((arg) =>
    arg.startsWith("--agent-version=")
  );
  const agentVersionInfo = agentVersionArg
    ? parseAgentVersion(agentVersionArg.split("=").slice(1).join("="))
    : null;

  // 解析外部傳入的開發報告（與開發計劃不同，開發報告是完成後的報告）
  // 開發報告包含：影響範圍、根本原因、改動前後邏輯差異（Bug）或預期效果、需求覆蓋率、潛在影響風險（Request）
  const developmentReportArg = args.find((arg) =>
    arg.startsWith("--development-report=")
  );
  const externalDevelopmentReport = developmentReportArg
    ? developmentReportArg.split("=").slice(1).join("=")
    : null;

  // 檢查是否有未提交的變更
  const uncommittedChanges = getGitStatus();
  if (uncommittedChanges.length > 0) {
    console.error("\n❌ 檢測到未提交的變更，無法建立 MR\n");
    console.error(`📋 未提交的檔案 (${uncommittedChanges.length} 個)：`);
    uncommittedChanges.slice(0, 10).forEach((change) => {
      console.error(`   ${change}`);
    });
    if (uncommittedChanges.length > 10) {
      console.error(`   ... 還有 ${uncommittedChanges.length - 10} 個檔案`);
    }
    console.error("\n⚠️  必須先 commit 所有變更才能建立 MR\n");
    process.exit(1);
  }

  let currentBranch = getCurrentBranch();

  // 檢查遠端分支是否存在
  let remoteBranchExists = false;
  try {
    const result = exec(`git ls-remote --heads origin ${currentBranch}`, {
      silent: true,
    });
    remoteBranchExists = result && result.trim().length > 0;
  } catch (error) {
    remoteBranchExists = false;
  }

  if (!remoteBranchExists) {
    console.error("\n❌ 遠端分支不存在，無法建立 MR\n");
    console.error(`📋 當前分支: ${currentBranch}`);
    console.error("⚠️  必須先推送分支到遠端才能建立 MR\n");
    process.exit(1);
  }

  // Pre-MR Rebase Requirement
  if (isRebaseInProgress()) {
    console.error("\n❌ 檢測到有未完成的 rebase，無法建立 MR\n");
    console.error("⚠️  請先完成或中止 rebase：");
    console.error("   - 繼續: git rebase --continue");
    console.error("   - 中止: git rebase --abort\n");
    process.exit(1);
  }

  console.log("============================================================");
  console.log("📋 Pre-MR Rebase Check");
  console.log("============================================================");
  console.log(`🌿 當前分支: ${currentBranch}`);
  console.log(`🎯 目標分支: ${targetBranch}`);

  const rebaseResult = rebaseToTargetBranch(targetBranch);
  if (!rebaseResult.success) {
    if (rebaseResult.hasConflict) {
      console.error("\n❌ Rebase 發生衝突，無法建立 MR\n");
      console.error("⚠️  需要手動解決衝突：");
      console.error("   1. git status（檢查衝突檔案）");
      console.error("   2. 解決衝突後 git add <檔案>");
      console.error("   3. git rebase --continue");
      console.error("   4. 重新執行 create-mr\n");
    } else {
      console.error(`\n❌ Rebase 失敗: ${rebaseResult.error}\n`);
    }
    process.exit(1);
  }

  console.log("============================================================\n");

  // 檢查是否需要 force push
  let needsForceWithLease = false;
  try {
    const localHead = exec("git rev-parse HEAD", { silent: true }).trim();
    const remoteHead = exec(`git rev-parse origin/${currentBranch}`, {
      silent: true,
    }).trim();

    if (localHead !== remoteHead) {
      try {
        exec(`git merge-base --is-ancestor origin/${currentBranch} HEAD`, {
          silent: true,
        });
        needsForceWithLease = false;
      } catch (e) {
        needsForceWithLease = true;
      }
    }
  } catch (error) {
    needsForceWithLease = false;
  }

  const unpushedCommits = getUnpushedCommits(currentBranch);
  if (unpushedCommits.length > 0 || needsForceWithLease) {
    if (needsForceWithLease) {
      console.log("\n⚠️  Rebase 後需要強制推送更新遠端分支\n");
    } else {
      console.log("\n⚠️  檢測到未推送的 commits！\n");
      console.log(`📋 未推送的 commits (${unpushedCommits.length} 個):`);
      unpushedCommits.slice(0, 10).forEach((commit) => {
        console.log(`   ${commit}`);
      });
      if (unpushedCommits.length > 10) {
        console.log(`   ... 還有 ${unpushedCommits.length - 10} 個 commits`);
      }
      console.log("");
    }

    const pushResult = pushToRemote(currentBranch, needsForceWithLease);
    if (!pushResult.success) {
      console.error("\n❌ 推送失敗，無法建立 MR\n");
      console.error(`   錯誤: ${pushResult.error}\n`);
      process.exit(1);
    }

    console.log("✅ 所有 commits 已成功推送到遠端\n");
  }

  // Reviewer 設置
  const reviewerArg = args.find((arg) => arg.startsWith("--reviewer="));
  const userExplicitlySetReviewer = !!reviewerArg;

  let reviewer;
  if (reviewerArg) {
    reviewer = reviewerArg.split("=")[1];
  } else {
    const envLocal = loadEnvLocal();
    reviewer = process.env.MR_REVIEWER || envLocal.MR_REVIEWER;

    if (!reviewer) {
      reviewer = "@william.chiang";
    }
  }

  const skipReview = args.includes("--no-review");

  const relatedTicketsArg = args
    .find((arg) => arg.startsWith("--related-tickets="))
    ?.split("=")[1];
  const commitMessageFull = getLastCommitMessage();
  const commitMessage = getLastCommitSubject();
  let ticket = currentBranch.match(/FE-\d+|IN-\d+/)?.[0] || "N/A";

  // 驗證 Jira ticket
  if (ticket !== "N/A" && isFeatureBranch(currentBranch)) {
    console.log(`🔍 正在檢查單號 ${ticket} 是否存在...\n`);
    const ticketCheck = await checkJiraTicketExists(ticket);

    if (ticketCheck.error) {
      console.log(`⚠️  無法檢查單號是否存在: ${ticketCheck.error}\n`);
      console.log(`   將繼續使用分支中的單號 ${ticket}\n`);
    } else if (!ticketCheck.exists) {
      const correctTicket = await getCorrectTicketFromUser(ticket);

      console.log(`\n🔍 正在驗證單號 ${correctTicket} 是否存在...\n`);
      const correctTicketCheck = await checkJiraTicketExists(correctTicket);

      if (correctTicketCheck.error) {
        console.log(`⚠️  無法驗證單號是否存在: ${correctTicketCheck.error}\n`);
        console.log(`   將繼續使用提供的單號 ${correctTicket}\n`);
      } else if (!correctTicketCheck.exists) {
        console.error(`\n❌ 提供的單號 ${correctTicket} 也不存在於 Jira 中\n`);
        console.error(`   請確認單號是否正確，然後重新執行命令\n`);
        process.exit(1);
      } else {
        console.log(`✅ 單號 ${correctTicket} 驗證成功\n`);
      }

      const oldBranch = currentBranch;
      const newBranch = oldBranch.replace(ticket, correctTicket);

      if (oldBranch === newBranch) {
        console.log(`⚠️  分支名稱中未找到單號，無法自動重命名\n`);
        console.log(`   請手動重命名分支後重新執行命令\n`);
        process.exit(1);
      }

      try {
        await renameBranch(oldBranch, newBranch);
        currentBranch = newBranch;
        ticket = correctTicket;
        console.log(`✅ 分支已重命名為: ${newBranch}\n`);
      } catch (error) {
        console.error(`\n❌ 重命名分支失敗: ${error.message}\n`);
        console.error(`   請手動重命名分支後重新執行命令\n`);
        process.exit(1);
      }
    } else {
      console.log(`✅ 單號 ${ticket} 驗證成功\n`);
    }
  }

  // 獲取 assignee
  console.log("👤 正在獲取當前用戶信息...\n");
  const assigneeId = await getGitLabUserId();
  let assignee = null;
  if (assigneeId) {
    if (hasGlab() && isGlabAuthenticated("gitlab.service-hub.tech")) {
      try {
        const result = exec("glab api user", { silent: true });
        if (result && result.trim()) {
          const userInfo = JSON.parse(result);
          if (userInfo && userInfo.username) {
            assignee = `@${userInfo.username}`;
          }
        }
      } catch (error) {
        assignee = assigneeId.toString();
      }
    } else {
      assignee = assigneeId.toString();
    }
    console.log(`✅ 已設置 assignee: ${assignee}\n`);
  } else {
    console.log("⚠️  無法獲取當前用戶信息，將不設置 assignee\n");
  }

  // 獲取 MR title
  let mrTitle = commitMessage;
  if (ticket !== "N/A") {
    console.log(`📋 正在獲取 Jira ticket ${ticket} 的 title...\n`);
    const jiraTitle = await getJiraTicketTitle(ticket);
    if (jiraTitle) {
      const commitMatch = commitMessage.match(/^(\w+)\([^)]+\):\s*(.+)$/);
      if (commitMatch) {
        const type = commitMatch[1];
        mrTitle = `${type}(${ticket}): ${jiraTitle}`;
      } else {
        mrTitle = `${ticket}: ${jiraTitle}`;
      }
      console.log(`✅ 已使用 Jira ticket title: ${mrTitle}\n`);
    } else {
      console.log(
        `⚠️  無法獲取 Jira ticket ${ticket} 的 title，將使用 commit message 作為 MR title\n`
      );
    }
  }

  // 構建 description
  let description = "";
  if (relatedTicketsArg) {
    const relatedTickets = relatedTicketsArg
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const allTickets = [ticket, ...relatedTickets].filter((t) => t !== "N/A");
    description = allTickets.join(" , ");
  } else {
    description = ticket;
  }

  const commitLines = commitMessageFull.split("\n");
  if (commitLines.length > 1) {
    const commitBody = commitLines.slice(1).join("\n").trim();
    if (commitBody) {
      description = description
        ? `${description}\n\n${commitBody}`
        : commitBody;
    }
  }

  // 讀取 start-task 的計劃（用於後續的 labels 判斷）
  const startTaskInfo = readStartTaskInfo();

  // 處理開發計劃：優先使用外部傳入，否則使用 start-task 的計劃
  if (externalDevelopmentPlan) {
    if (externalDevelopmentPlan.raw) {
      // 外部傳入完整計劃，直接使用
      console.log("📋 使用外部傳入的完整開發計劃\n");
      description = description
        ? `${description}\n\n${externalDevelopmentPlan.raw}`
        : externalDevelopmentPlan.raw;
    } else {
      // 結構化計劃，走格式化流程
      const planSection = generateDevelopmentPlanSection(
        externalDevelopmentPlan
      );
      if (planSection) {
        console.log("📋 檢測到開發計劃，將添加到 MR description\n");
        description = description
          ? `${description}\n\n${planSection}`
          : planSection;
      }
    }
  } else {
    // 沒有外部傳入，使用 start-task 的計劃
    if (startTaskInfo) {
      const planSection = generateDevelopmentPlanSection(startTaskInfo);
      if (planSection) {
        console.log("📋 檢測到開發計劃，將添加到 MR description\n");
        description = description
          ? `${description}\n\n${planSection}`
          : planSection;
      }
    }
  }

  // 處理開發報告：外部傳入的開發報告直接添加到 description
  // 開發報告與開發計劃不同：
  // - 開發計劃（--development-plan）：開發前的計劃步驟
  // - 開發報告（--development-report）：開發完成後的報告，包含影響範圍、根本原因、改動差異等
  if (externalDevelopmentReport) {
    console.log("📊 使用外部傳入的開發報告\n");
    description = description
      ? `${description}\n\n${externalDevelopmentReport}`
      : externalDevelopmentReport;
  }

  // 添加關聯單資訊區塊（獨立於開發計劃，只顯示單號、標題、類型）
  if (startTaskInfo) {
    const relatedTicketsSection = generateRelatedTicketsSection(startTaskInfo);
    if (relatedTicketsSection) {
      console.log("📋 添加關聯單資訊到 MR description\n");
      description = description
        ? `${description}\n\n${relatedTicketsSection}`
        : relatedTicketsSection;
    }
  }

  // 添加 Agent 版本資訊到 description 最下方
  if (agentVersionInfo) {
    const versionSection = generateAgentVersionSection(agentVersionInfo);
    if (versionSection) {
      console.log("🤖 檢測到 Agent 版本資訊，將添加到 MR description 最下方\n");
      description = description
        ? `${description}\n\n${versionSection}`
        : versionSection;
    }
  }

  // 根據 Jira ticket 決定 labels（不再自動分析 v3/v4，由外部傳入）
  console.log("🔍 分析 Jira ticket 信息...\n");
  let labels = [];

  const labelResult = await determineLabels(ticket, {
    startTaskInfo,
  });
  labels = labelResult.labels;

  if (labelResult.releaseBranch) {
    const originalTargetBranch = targetBranch;
    targetBranch = labelResult.releaseBranch;
    console.log(
      `   → 檢測到 Hotfix，自動設置 target branch: ${originalTargetBranch} → ${targetBranch}\n`
    );
  }

  if (labels.length > 0) {
    console.log(`🏷️  自動產生的 labels: ${labels.join(", ")}\n`);
  }

  // 合併外部傳入的 labels（去重）
  if (externalLabels.length > 0) {
    console.log(`🏷️  外部傳入的 labels: ${externalLabels.join(", ")}`);
    for (const label of externalLabels) {
      if (!labels.includes(label)) {
        labels.push(label);
      }
    }
    console.log(`🏷️  最終 labels: ${labels.join(", ")}\n`);
  } else if (labels.length > 0) {
    console.log(`🏷️  將添加 labels: ${labels.join(", ")}\n`);
  }

  // Hotfix target branch 確認
  const hasHotfixLabel = labels.includes("Hotfix");
  const isReleaseBranch = /^release\//.test(targetBranch);
  if (hasHotfixLabel && !isReleaseBranch && userExplicitlySetTarget) {
    console.log(
      "⚠️  檢測到 Hotfix label，但用戶明確指定的 target branch 不是 release/*\n"
    );
    console.log(`   當前 target branch: ${targetBranch}`);
    console.log(`   Hotfix 通常應該合併到 release/* 分支\n`);

    await new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(
        `❓ 確定 target branch 為 ${targetBranch} 嗎？(y/N): `,
        (answer) => {
          rl.close();
          const confirmed =
            answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
          if (!confirmed) {
            console.log(
              "\n❌ 已取消建立 MR。請確認 target branch 是否正確。\n"
            );
            process.exit(0);
          }
          resolve();
        }
      );
    });
  }

  // 查找現有 MR
  let existingMR = null;
  let existingMRId = null;
  let existingMRDetails = null;
  let shouldUpdateReviewer = true;

  if (hasGlab()) {
    const hostname = "gitlab.service-hub.tech";

    if (isGlabAuthenticated(hostname)) {
      existingMRId = findExistingMRWithGlab(currentBranch);
      if (existingMRId) {
        console.log(`\n🔍 發現現有 MR: !${existingMRId}\n`);
        existingMR = { iid: existingMRId };
        existingMRDetails = getMRDetailsWithGlab(existingMRId);
      }
    }
  }

  if (!existingMR || (existingMR && !existingMRDetails)) {
    const token = getGitLabToken();
    if (token) {
      const projectInfo = getProjectInfo();
      if (!existingMR) {
        existingMR = await findExistingMR(
          token,
          projectInfo.host,
          projectInfo.projectPath,
          currentBranch
        );
        if (existingMR) {
          existingMRId = existingMR.iid;
          console.log(`\n🔍 發現現有 MR: !${existingMRId}\n`);
        }
      }
      if (existingMR && existingMRId && !existingMRDetails) {
        existingMRDetails = await getMRDetails(
          token,
          projectInfo.host,
          projectInfo.projectPath,
          existingMRId
        );
      }
    }
  }

  // 檢查是否應該更新 reviewer
  if (existingMRDetails) {
    const hasExistingReviewers =
      existingMRDetails.reviewers && existingMRDetails.reviewers.length > 0;
    if (hasExistingReviewers && !userExplicitlySetReviewer) {
      shouldUpdateReviewer = false;
      const existingReviewers = existingMRDetails.reviewers
        .map((r) => {
          if (r.username) return `@${r.username}`;
          if (r.name) return r.name;
          return r.id ? `User ID: ${r.id}` : "Unknown";
        })
        .join(", ");
      console.log(`ℹ️  現有 MR 已有 reviewer: ${existingReviewers}`);
      console.log(`   用戶未明確指定 reviewer，將保留現有 reviewer\n`);
    }
  }

  if (existingMR) {
    console.log("🔄 更新現有 Merge Request...\n");
  } else {
    console.log("\n🔨 建立 Merge Request...\n");
  }

  console.log(`🌿 來源分支: ${currentBranch}`);
  console.log(`🎯 目標分支: ${targetBranch}`);
  console.log(`📝 標題: ${mrTitle}`);
  console.log(`📋 Draft: ${draft ? "是" : "否"}`);
  console.log(`👤 Reviewer: ${reviewer}`);
  if (assignee) {
    console.log(`👤 Assignee: ${assignee}`);
  }
  console.log("");

  // 使用 glab CLI
  if (hasGlab()) {
    const hostname = "gitlab.service-hub.tech";
    const sshConfigured = isSSHConfigured(hostname);

    if (sshConfigured) {
      console.log("✅ 檢測到 SSH 已配置，將使用 SSH 進行 Git 操作\n");
    }

    if (!isGlabAuthenticated(hostname)) {
      console.log("🔐 檢測到 glab 尚未登入，需要進行認證...\n");

      if (sshConfigured) {
        console.log(
          "💡 你的 SSH 已配置，只需要 Personal Access Token 進行 API 調用"
        );
        console.log("   Git 操作將自動使用 SSH 協議\n");
      }

      let token = getGitLabToken();

      if (!token) {
        console.log("📝 首次使用需要設置 GitLab Personal Access Token\n");

        try {
          token = await getTokenFromUser();
        } catch (error) {
          console.error("❌ 無法獲取 token");
          console.log("\n💡 你也可以稍後設置 token 並重新執行：");
          console.log('   export GITLAB_TOKEN="YOUR_TOKEN"');
          console.log('   pnpm run create-mr --reviewer="@william.chiang"\n');
          console.log("嘗試使用 API token 方式...\n");
        }
      }

      if (token) {
        console.log("🔑 使用 token 登入 glab...");
        try {
          loginGlabWithToken(hostname, token, sshConfigured);
          console.log("✅ 登入成功！\n");
          if (sshConfigured) {
            console.log("✅ Git 操作將使用 SSH 協議\n");
          }
        } catch (error) {
          console.error(`❌ 登入失敗: ${error.message}\n`);
          console.log("嘗試使用 API token 方式...\n");
        }
      }
    } else if (sshConfigured) {
      console.log("✅ Git 操作將使用 SSH 協議\n");
    }

    if (isGlabAuthenticated(hostname)) {
      if (existingMR) {
        console.log("✅ 使用 GitLab CLI (glab) 更新 MR...\n");
        try {
          const result = updateMRWithGlab(
            existingMRId,
            null,
            description,
            draft,
            reviewer,
            labels,
            shouldUpdateReviewer
          );

          console.log("\n✅ MR 更新成功！\n");

          const mrUrlMatch = result.match(
            /https:\/\/[^\s]+merge_requests\/(\d+)/
          );
          if (mrUrlMatch) {
            const mrUrl = mrUrlMatch[0];
            const mrId = mrUrlMatch[1];
            console.log(`🔗 MR 連結: [MR !${mrId}](${mrUrl})`);
            console.log(`📊 MR ID: !${mrId}`);

            const jiraTickets = extractJiraTickets(description);
            if (jiraTickets.length > 0) {
              const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
              console.log(`🎫 關聯 Jira: ${jiraLinks}`);
            }
            console.log("");

            if (!skipReview) {
              console.log("🤖 正在提交 AI review...");
              try {
                await submitAIReview(mrUrl);
                console.log("✅ AI review 已提交\n");
              } catch (error) {
                console.error(`⚠️  AI review 提交失敗: ${error.message}\n`);
              }
            } else {
              console.log("⏭️  跳過 AI review（--no-review）\n");
            }
          } else {
            console.log(result);
            if (!skipReview) {
              console.log("⚠️  無法提取 MR URL，跳過 AI review 提交\n");
            } else {
              console.log("⏭️  跳過 AI review（--no-review）\n");
            }
          }
          return;
        } catch (error) {
          console.error(`\n❌ glab 更新失敗: ${error.message}\n`);
          console.log("嘗試使用 API token 方式...\n");
        }
      } else {
        console.log("✅ 使用 GitLab CLI (glab) 建立 MR...\n");
        try {
          const result = createMRWithGlab(
            currentBranch,
            targetBranch,
            mrTitle,
            description,
            draft,
            reviewer,
            assignee,
            labels
          );

          console.log("\n✅ MR 建立成功！\n");

          const mrUrlMatch = result.match(
            /https:\/\/[^\s]+merge_requests\/(\d+)/
          );
          if (mrUrlMatch) {
            const mrUrl = mrUrlMatch[0];
            const mrId = mrUrlMatch[1];
            console.log(`🔗 MR 連結: [MR !${mrId}](${mrUrl})`);
            console.log(`📊 MR ID: !${mrId}`);

            const jiraTickets = extractJiraTickets(description);
            if (jiraTickets.length > 0) {
              const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
              console.log(`🎫 關聯 Jira: ${jiraLinks}`);
            }
            console.log("");

            if (!skipReview) {
              console.log("🤖 正在提交 AI review...");
              try {
                await submitAIReview(mrUrl);
                console.log("✅ AI review 已提交\n");
              } catch (error) {
                console.error(`⚠️  AI review 提交失敗: ${error.message}\n`);
              }
            } else {
              console.log("⏭️  跳過 AI review（--no-review）\n");
            }
          } else {
            console.log(result);
            if (!skipReview) {
              console.log("⚠️  無法提取 MR URL，跳過 AI review 提交\n");
            } else {
              console.log("⏭️  跳過 AI review（--no-review）\n");
            }
          }
          return;
        } catch (error) {
          console.error(`\n❌ glab 執行失敗: ${error.message}\n`);
          console.log("嘗試使用 API token 方式...\n");
        }
      }
    }
  }

  // 使用 API token
  const token = getGitLabToken();
  if (!token) {
    console.error("❌ 未找到 GitLab 認證方式\n");
    console.error("請選擇以下方式之一：\n");
    console.error("方式 1: 安裝 GitLab CLI (推薦，使用你的 GitLab 帳號)");
    console.error("  brew install glab  # macOS");
    console.error("  或訪問: https://github.com/profclems/glab");
    console.error(
      "  然後執行: glab auth login --hostname gitlab.service-hub.tech\n"
    );
    console.error("方式 2: 設置 API token\n");
    console.error("💡 如何獲取 Token：");
    console.error(
      "   1. 前往: https://gitlab.service-hub.tech/-/user_settings/personal_access_tokens"
    );
    console.error('   2. 點擊 "Add new token"');
    console.error('   3. 填寫 Token name（例如: "glab-cli"）');
    console.error("   4. 選擇 Expiration date（可選）");
    console.error("   5. 勾選權限: api, write_repository");
    console.error('   6. 點擊 "Create personal access token"');
    console.error("   7. 複製生成的 token（只會顯示一次）\n");
    console.error("💡 設置 Token：");
    console.error("   臨時設置（當前終端會話）:");
    console.error('     export GITLAB_TOKEN="your-token"');
    console.error("   永久設置（推薦）:");
    console.error('     git config --global gitlab.token "your-token"');
    console.error(
      '   設置後重新執行: pnpm run create-mr --reviewer="@william.chiang"\n'
    );

    process.exit(1);
  }

  const projectInfo = getProjectInfo();

  console.log(`📍 項目: ${projectInfo.fullPath}`);

  // 查找 reviewer ID
  let reviewerId = null;
  if (reviewer) {
    if (/^\d+$/.test(reviewer)) {
      reviewerId = parseInt(reviewer, 10);
      console.log(`✅ 使用用戶 ID: ${reviewerId}\n`);
    } else {
      console.log(`🔍 查找用戶: ${reviewer}...`);
      reviewerId = await findUserId(token, projectInfo.host, reviewer);
      if (reviewerId) {
        console.log(`✅ 找到用戶 ID: ${reviewerId}\n`);
      } else {
        console.error(`\n❌ 未找到用戶: ${reviewer}`);
        console.error(`\n💡 請在 Cursor chat 中選擇 reviewer：`);
        console.error(`   1. 使用預設 reviewer (william.chiang)`);
        console.error(`   2. 重新輸入 reviewer 用戶名`);
        console.error(
          `\n   然後重新執行: pnpm run create-mr --reviewer="<選擇的reviewer>"\n`
        );

        process.exit(1);
      }
    }
  }

  // 建立或更新 MR
  if (existingMR) {
    console.log("🚀 正在更新 MR...");
    try {
      const mr = await updateMR(
        token,
        projectInfo.host,
        projectInfo.projectPath,
        existingMRId,
        null,
        description,
        draft,
        reviewerId,
        labels,
        shouldUpdateReviewer
      );

      console.log("\n✅ MR 更新成功！\n");
      console.log(`🔗 MR 連結: [MR !${mr.iid}](${mr.web_url})`);
      console.log(`📊 MR ID: !${mr.iid}`);
      console.log(`📝 標題: ${mr.title}`);
      console.log(`📋 狀態: ${mr.work_in_progress ? "Draft" : "Open"}`);
      if (labels.length > 0) {
        console.log(`🏷️  Labels: ${labels.join(", ")}`);
      }
      if (mr.reviewers && mr.reviewers.length > 0) {
        console.log(
          `👤 Reviewers: ${mr.reviewers.map((r) => r.username).join(", ")}`
        );
      }
      const jiraTickets = extractJiraTickets(description);
      if (jiraTickets.length > 0) {
        const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
        console.log(`🎫 關聯 Jira: ${jiraLinks}`);
      }
      console.log("");

      if (!skipReview) {
        console.log("🤖 正在提交 AI review...");
        try {
          await submitAIReview(mr.web_url);
          console.log("✅ AI review 已提交\n");
        } catch (error) {
          console.error(`⚠️  AI review 提交失敗: ${error.message}\n`);
        }
      } else {
        console.log("⏭️  跳過 AI review（--no-review）\n");
      }
    } catch (error) {
      console.error(`\n❌ ${error.message}\n`);
      process.exit(1);
    }
  } else {
    console.log("🚀 正在建立 MR...");
    try {
      const mr = await createMR(
        token,
        projectInfo.host,
        projectInfo.projectPath,
        currentBranch,
        targetBranch,
        mrTitle,
        description,
        draft,
        reviewerId,
        assigneeId,
        labels
      );

      console.log("\n✅ MR 建立成功！\n");
      console.log(`🔗 MR 連結: [MR !${mr.iid}](${mr.web_url})`);
      console.log(`📊 MR ID: !${mr.iid}`);
      console.log(`📝 標題: ${mr.title}`);
      console.log(`📋 狀態: ${mr.work_in_progress ? "Draft" : "Open"}`);
      if (labels.length > 0) {
        console.log(`🏷️  Labels: ${labels.join(", ")}`);
      }
      if (mr.reviewers && mr.reviewers.length > 0) {
        console.log(
          `👤 Reviewers: ${mr.reviewers.map((r) => r.username).join(", ")}`
        );
      }
      const jiraTickets = extractJiraTickets(description);
      if (jiraTickets.length > 0) {
        const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
        console.log(`🎫 關聯 Jira: ${jiraLinks}`);
      }
      console.log("");

      if (!skipReview) {
        console.log("🤖 正在提交 AI review...");
        try {
          await submitAIReview(mr.web_url);
          console.log("✅ AI review 已提交\n");
        } catch (error) {
          console.error(`⚠️  AI review 提交失敗: ${error.message}\n`);
        }
      } else {
        console.log("⏭️  跳過 AI review（--no-review）\n");
      }
    } catch (error) {
      console.error(`\n❌ ${error.message}\n`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(`\n❌ 發生錯誤: ${error.message}\n`);
  process.exit(1);
});

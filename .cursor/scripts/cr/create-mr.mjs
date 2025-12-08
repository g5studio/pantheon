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
    // 返回第一個 open 的 MR
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
    // 解析輸出，查找 MR ID
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
  // if (title) {
  //   args.push('--title', draft ? `Draft: ${title}` : title);
  // }

  if (description) {
    args.push("--description", description);
  }

  // 設置 draft 狀態
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

  // 預設設定 delete source branch
  args.push("--remove-source-branch");

  try {
    const result = spawnSync("glab", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"], // 捕獲 stdout
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`glab 退出碼: ${result.status}`);
    }

    // 輸出結果到控制台
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
    draft ? `Draft: ${title}` : title, // 確保標題包含 Draft 前綴
    "--description",
    description,
    "--remove-source-branch", // 合併後刪除來源分支
  ];

  // 同時使用 --draft 標誌和標題前綴，確保 draft 狀態
  if (draft) {
    args.push("--draft");
  }

  if (assignee) {
    // glab 支持 @ 符號格式或用戶 ID
    args.push("--assignee", assignee);
  }

  if (reviewer) {
    // glab 支持 @ 符號格式或用戶 ID
    args.push("--reviewer", reviewer);
  }

  if (labels && labels.length > 0) {
    args.push("--label", labels.join(","));
  }

  // 預設設定 delete source branch
  args.push("--remove-source-branch");

  try {
    // 使用 spawnSync 來確保參數正確傳遞，並捕獲輸出
    const result = spawnSync("glab", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"], // 捕獲 stdout
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`glab 退出碼: ${result.status}`);
    }

    // 輸出結果到控制台
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

  // 解析 SSH URL: git@gitlab.service-hub.tech:frontend/fluid-two.git
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

  // 解析 HTTPS URL
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

// 獲取未推送的 commits（已提交但尚未推送到遠端的 commits）
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
    // 如果遠端分支不存在，返回空陣列（將在其他地方處理）
    return [];
  }
}

// 推送 commits 到遠端
// forceWithLease: 如果為 true，使用 --force-with-lease（用於 rebase 後的推送）
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

  // Step 1: Fetch 最新的目標分支
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

  // Step 2: 執行 rebase
  console.log(`🔀 正在執行 git rebase origin/${targetBranch}...`);
  try {
    exec(`git rebase origin/${targetBranch}`, { silent: false });
    console.log(`\n✅ Rebase 成功！\n`);
    return { success: true, error: null, hasConflict: false };
  } catch (error) {
    // 檢查是否有衝突
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
      // 無法檢查狀態，視為一般錯誤
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
    // 檢查 .git/rebase-merge 或 .git/rebase-apply 目錄是否存在
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

// 中止 rebase
function abortRebase() {
  try {
    exec("git rebase --abort", { silent: true });
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 重命名分支（本地和遠端）
async function renameBranch(oldBranch, newBranch) {
  try {
    // 檢查新分支是否已存在
    try {
      const existingBranch = exec(`git rev-parse --verify ${newBranch}`, {
        silent: true,
      });
      if (existingBranch) {
        throw new Error(`分支 ${newBranch} 已存在`);
      }
    } catch (error) {
      // 如果分支不存在，這是正常的，繼續執行
      if (!error.message.includes("fatal: not a valid object name")) {
        throw error;
      }
    }

    // 重命名本地分支
    console.log(`🔄 正在重命名本地分支: ${oldBranch} -> ${newBranch}`);
    exec(`git branch -m ${oldBranch} ${newBranch}`);

    // 檢查遠端是否存在舊分支
    let remoteExists = false;
    try {
      const result = exec(`git ls-remote --heads origin ${oldBranch}`, {
        silent: true,
      });
      // 檢查輸出結果是否為空，如果為空表示分支不存在
      // git ls-remote 在分支存在時會返回類似 "hash\trefs/heads/branch-name" 的結果
      remoteExists = result && result.trim().length > 0;
    } catch (error) {
      // 命令執行失敗，視為分支不存在
      remoteExists = false;
    }

    if (remoteExists) {
      // 如果遠端存在，需要刪除遠端舊分支並推送新分支
      console.log(`🔄 正在更新遠端分支...`);
      try {
        exec(`git push origin :${oldBranch}`, { silent: true }); // 刪除遠端舊分支
      } catch (error) {
        // 如果刪除遠端分支失敗（可能是權限問題），只推送新分支
        console.log(`⚠️  無法刪除遠端舊分支，將只推送新分支`);
      }
      exec(`git push origin ${newBranch}`, { silent: true }); // 推送新分支
      exec(`git branch --set-upstream-to=origin/${newBranch} ${newBranch}`, {
        silent: true,
      }); // 設置追蹤
      console.log(`✅ 已更新遠端分支\n`);
    } else {
      // 遠端分支不存在，只推送新分支
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

// 檢查是否為 feature branch（fix/、feat/、feature/ 開頭）
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
      // 驗證格式
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

// 獲取改動的檔案列表（相對於目標分支）
function getChangedFiles(targetBranch = "main") {
  try {
    // 獲取當前分支與目標分支之間的差異檔案
    const result = exec(`git diff --name-only origin/${targetBranch}...HEAD`, {
      silent: true,
    });
    return result
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .filter((file) => file.startsWith("src/"));
  } catch (error) {
    // 如果目標分支不存在，嘗試使用當前分支的最後一次 commit
    try {
      const result = exec("git diff --name-only HEAD~1 HEAD", { silent: true });
      return result
        .trim()
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .filter((file) => file.startsWith("src/"));
    } catch (error2) {
      return [];
    }
  }
}

// 獲取檔案的 git diff 內容
function getFileDiff(filePath, targetBranch = "main") {
  try {
    // 獲取相對於目標分支的 diff
    const relativePath = filePath.replace(projectRoot + "/", "");
    const result = exec(
      `git diff origin/${targetBranch}...HEAD -- "${relativePath}"`,
      { silent: true }
    );
    return result.trim();
  } catch (error) {
    // 如果目標分支不存在，嘗試使用當前分支的最後一次 commit
    try {
      const relativePath = filePath.replace(projectRoot + "/", "");
      const result = exec(`git diff HEAD~1 HEAD -- "${relativePath}"`, {
        silent: true,
      });
      return result.trim();
    } catch (error2) {
      return "";
    }
  }
}

// 提取 formatClasses 調用中某個版本實際應用的類名
function extractClassesForVersion(formatClassesCode, version) {
  const classes = new Set();

  // 提取基礎類名（不在條件中的）
  const baseClassMatch = formatClassesCode.match(
    /formatClasses\s*\(\s*['"`]([^'"`]+)['"`]/
  );
  if (baseClassMatch) {
    baseClassMatch[1].split(/\s+/).forEach((cls) => cls && classes.add(cls));
  }

  // 提取條件類名
  // 匹配: { 'class1 class2': isV3() } 或 { [formatClasses(...)]: isV4() } 或 { [colors.text.Text.primary]: isV4() }
  const conditionPattern = new RegExp(
    `\\{\\s*(?:['"\`]([^'"\`]+)['"\`]|\\[([^\\]]+)\\])\\s*:\\s*isV${version}\\(\\)\\s*\\}`,
    "g"
  );

  let match;
  while ((match = conditionPattern.exec(formatClassesCode)) !== null) {
    // match[1] 是字符串字面量，match[2] 是方括號內的表達式
    const classStr = match[1] || match[2];
    if (classStr) {
      if (match[1]) {
        // 字符串字面量，直接分割
        classStr.split(/\s+/).forEach((cls) => cls && classes.add(cls));
      } else {
        // 表達式（如 colors.text.Text.primary）
        // 這裡我們使用表達式本身作為標識符，因為我們無法在靜態分析時知道實際的類名映射
        // 但我們可以通過比較表達式來判斷是否改變
        // 對於常見的顏色變數，我們知道它們對應的類名
        if (classStr.includes("colors.text.Text.primary")) {
          classes.add("text-primary-text"); // colors.text.Text.primary 對應 text-primary-text
        } else if (classStr.includes("formatClasses")) {
          // 嵌套的 formatClasses，遞歸處理
          const nestedClasses = extractClassesForVersion(classStr, version);
          nestedClasses.split(/\s+/).forEach((cls) => cls && classes.add(cls));
        } else {
          // 其他表達式，使用表達式本身作為標識
          classes.add(`[${classStr.trim()}]`);
        }
      }
    }
  }

  return Array.from(classes).sort().join(" ");
}

// 提取完整的 formatClasses 調用（支持多行）
function extractFormatClassesCall(code) {
  const startIndex = code.indexOf("formatClasses");
  if (startIndex === -1) return null;

  // 找到 formatClasses( 的位置
  const openParenIndex = code.indexOf("(", startIndex);
  if (openParenIndex === -1) return null;

  // 使用括號匹配來找到完整的調用
  let parenCount = 0;
  let inString = false;
  let stringChar = null;

  for (let i = openParenIndex; i < code.length; i++) {
    const char = code[i];
    const prevChar = i > 0 ? code[i - 1] : "";

    // 處理字符串
    if (!inString && (char === '"' || char === "'" || char === "`")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== "\\") {
      inString = false;
      stringChar = null;
    }

    if (!inString) {
      if (char === "(") {
        parenCount++;
      } else if (char === ")") {
        parenCount--;
        if (parenCount === 0) {
          return code.substring(startIndex, i + 1);
        }
      }
    }
  }

  return null;
}

// 比較改動前後的實際效果
function compareVersionImpact(beforeCode, afterCode) {
  const impact = { v3: false, v4: false };

  // 提取 formatClasses 調用（支持多行）
  const beforeFormatClasses = extractFormatClassesCall(beforeCode);
  const afterFormatClasses = extractFormatClassesCall(afterCode);

  if (!beforeFormatClasses || !afterFormatClasses) {
    // 如果沒有 formatClasses 調用，使用原有邏輯
    return null;
  }

  const beforeClasses = beforeFormatClasses;
  const afterClasses = afterFormatClasses;

  // 比較 v3 的實際效果
  const beforeV3Classes = extractClassesForVersion(beforeClasses, 3);
  const afterV3Classes = extractClassesForVersion(afterClasses, 3);
  if (beforeV3Classes !== afterV3Classes) {
    impact.v3 = true;
  }

  // 比較 v4 的實際效果
  const beforeV4Classes = extractClassesForVersion(beforeClasses, 4);
  const afterV4Classes = extractClassesForVersion(afterClasses, 4);
  if (beforeV4Classes !== afterV4Classes) {
    impact.v4 = true;
  }

  return impact;
}

// 分析 git diff 內容判斷影響範圍
function analyzeDiffImpact(diffContent, fileContent) {
  const impact = {
    v3: false,
    v4: false,
  };

  if (!diffContent || diffContent.length === 0) {
    return impact;
  }

  // 解析 diff 獲取改動的行號，同時保留刪除和新增的配對信息
  const diffLines = diffContent.split("\n");
  const changedLines = [];
  const removedLines = []; // 記錄刪除的行，用於配對分析
  let currentLine = 0;
  let inHunk = false;
  let hunkStartLine = 0;
  let oldLineNum = 0; // 舊檔案的行號

  for (const line of diffLines) {
    // 匹配 hunk 標頭，例如: @@ -73,7 +73,7 @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      inHunk = true;
      hunkStartLine = parseInt(hunkMatch[3], 10); // 新檔案的行號
      oldLineNum = parseInt(hunkMatch[1], 10) - 1; // 舊檔案的行號
      currentLine = hunkStartLine - 1; // 減 1 因為下一行會增加
      continue;
    }

    if (inHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        // 新增的行
        currentLine++;
        changedLines.push({
          line: currentLine,
          type: "added",
          content: line.substring(1),
          oldLine: null, // 將在配對時設置
        });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        // 刪除的行
        oldLineNum++;
        const removedContent = line.substring(1);
        removedLines.push({ oldLine: oldLineNum, content: removedContent });
        currentLine++;
        changedLines.push({
          line: currentLine,
          type: "removed",
          content: removedContent,
          oldLine: oldLineNum,
        });
      } else if (line.startsWith(" ")) {
        // 未改動的行
        currentLine++;
        oldLineNum++;
      } else if (line.startsWith("\\")) {
        // diff 結束標記
        inHunk = false;
      }
    }
  }

  // 配對新增和刪除的行，用於比較改動前後的值
  for (let i = 0; i < changedLines.length; i++) {
    const changed = changedLines[i];
    if (changed.type === "added") {
      // 尋找對應的刪除行（在同一 hunk 內，位置相近）
      for (
        let j = Math.max(0, i - 5);
        j < Math.min(changedLines.length, i + 5);
        j++
      ) {
        if (changedLines[j].type === "removed" && !changedLines[j].paired) {
          changed.oldLine = changedLines[j].oldLine;
          changed.pairedContent = changedLines[j].content;
          changedLines[j].paired = true;
          break;
        }
      }
    }
  }

  if (changedLines.length === 0) {
    return impact;
  }

  const fileLines = fileContent.split("\n");

  // 嘗試從 diff 中提取改動前後的完整 formatClasses 調用進行比較
  // 尋找包含 formatClasses 的改動區域
  const formatClassesChanges = [];

  // 找到包含 formatClasses 的改動區域
  const formatClassesChangedLines = changedLines.filter(
    (changed) =>
      changed.content.includes("formatClasses") ||
      changed.content.includes("isV3()") ||
      changed.content.includes("isV4()")
  );

  if (formatClassesChangedLines.length > 0) {
    // 找到改動區域的範圍
    const minLine = Math.min(...formatClassesChangedLines.map((c) => c.line));
    const maxLine = Math.max(...formatClassesChangedLines.map((c) => c.line));
    const contextStart = Math.max(0, minLine - 10);
    const contextEnd = Math.min(fileLines.length, maxLine + 10);

    // 從當前文件提取改動後的代碼
    const afterContext = fileLines.slice(contextStart, contextEnd).join("\n");

    // 從 diff 中重建改動前的代碼
    // 方法：從當前代碼開始，移除新增的行，添加刪除的行
    let beforeContext = afterContext;

    // 移除新增的行（這些行在改動前不存在）
    for (const added of addedLines) {
      if (added.line >= contextStart && added.line < contextEnd) {
        const addedContent = added.content.trim();
        // 從 afterContext 中找到並移除這一行
        const lines = beforeContext.split("\n");
        const filteredLines = lines.filter(
          (line) =>
            !line.trim().includes(addedContent) ||
            (line.trim() !== addedContent &&
              !line
                .trim()
                .match(
                  new RegExp(
                    addedContent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                  )
                ))
        );
        beforeContext = filteredLines.join("\n");
      }
    }

    // 添加刪除的行（這些行在改動前存在）
    // 需要找到合適的位置插入
    for (const removed of removedLines) {
      const removedContent = removed.content.trim();
      // 如果刪除的行包含基礎類名（不在條件中的），應該在第一個參數位置
      if (
        removedContent.includes("text-primary") &&
        !removedContent.includes("isV3()") &&
        !removedContent.includes("isV4()")
      ) {
        // 在 formatClasses( 之後插入
        beforeContext = beforeContext.replace(
          /(formatClasses\s*\(\s*)/,
          `$1${removedContent},\n                `
        );
      }
    }

    // 清理格式
    beforeContext = beforeContext
      .replace(/,\s*,/g, ",")
      .replace(/\n\s*\n+/g, "\n");

    if (
      beforeContext &&
      afterContext &&
      beforeContext.includes("formatClasses") &&
      afterContext.includes("formatClasses")
    ) {
      const comparison = compareVersionImpact(beforeContext, afterContext);
      if (comparison) {
        formatClassesChanges.push(comparison);
      }
    }
  }

  // 分析每個改動行，檢查它是否在特定版本條件塊內
  for (const changed of changedLines) {
    const lineNum = changed.line;
    const changedLine = changed.content.trim();

    // 檢查改動行本身是否包含版本條件
    // 但不要立即標記，需要進一步分析是否真的改變了行為
    let hasV4Condition = changedLine.includes("isV4()");
    let hasV3Condition = changedLine.includes("isV3()");

    // 如果改動行包含 isV4() 或 isV3()，且改動行包含 formatClasses，直接標記
    // 這能處理跨行的 formatClasses 調用情況
    if (hasV4Condition && changedLine.includes("formatClasses")) {
      foundV4Condition = true;
    }
    if (hasV3Condition && changedLine.includes("formatClasses")) {
      foundV3Condition = true;
    }

    // 檢查改動行附近的上下文（前後 10 行）
    const startLine = Math.max(0, lineNum - 11);
    const endLine = Math.min(fileLines.length, lineNum + 10);
    const contextLines = fileLines.slice(startLine, endLine);

    // 構建包含改動行的完整上下文
    const contextBefore = contextLines
      .slice(0, lineNum - startLine - 1)
      .join("\n");
    const contextAfter = contextLines.slice(lineNum - startLine).join("\n");
    const fullContext =
      contextBefore + "\n" + changedLine + "\n" + contextAfter;

    // 檢查是否在 formatClasses 的版本條件塊內
    // 匹配模式: { [formatClasses(...)]: isV4() } 或 { '...': isV4() }
    // 需要檢查改動行是否在這個條件塊的範圍內

    // 方法：尋找包含 isV4() 或 isV3() 的 formatClasses 調用
    // 然後檢查改動行是否在該調用的參數範圍內

    // 更簡單的方法：檢查改動行前後是否有 isV4() 或 isV3() 條件
    // 如果改動行在 formatClasses 調用中，且該調用在 isV4() 條件內，則只影響 v4

    // 檢查 formatClasses 的多行結構
    // 例如：
    // formatClasses(
    //   'text-xs font-semibold',
    //   { 'leading-3_25 text-primary': isV3() },
    //   { [formatClasses(colors.text.Text.primary, 'leading-4')]: isV4() },
    // )
    let foundV4Condition = false;
    let foundV3Condition = false;

    // 在上下文中尋找 formatClasses 調用
    for (let i = 0; i < contextLines.length; i++) {
      const line = contextLines[i];
      const actualLineNum = startLine + i + 1;

      // 檢查是否在同一行或附近有 isV4() 條件
      if (line.includes("isV4()") && line.includes("formatClasses")) {
        // 檢查改動行是否在這個條件塊內
        // 如果改動行在包含 isV4() 的行附近（前後 3 行），且改動行包含 formatClasses
        if (
          Math.abs(actualLineNum - lineNum) <= 3 &&
          changedLine.includes("formatClasses")
        ) {
          foundV4Condition = true;
        }
      }

      if (line.includes("isV3()") && line.includes("formatClasses")) {
        if (
          Math.abs(actualLineNum - lineNum) <= 3 &&
          changedLine.includes("formatClasses")
        ) {
          foundV3Condition = true;
        }
      }
    }

    // 更精確的檢查：使用正則表達式匹配 formatClasses 的完整結構
    // 匹配: { [formatClasses(...)]: isV4() } 或跨行的 formatClasses 調用
    // 需要支持多行匹配，因為 formatClasses 可能跨多行
    const v4Pattern = /\{\s*\[formatClasses\([^)]*\)\]:\s*isV4\(\)\s*\}/s;
    const v3Pattern = /\{\s*\[formatClasses\([^)]*\)\]:\s*isV3\(\)\s*\}/s;

    // 檢查改動行是否匹配這些模式（單行）
    if (v4Pattern.test(changedLine)) {
      foundV4Condition = true;
    }
    if (v3Pattern.test(changedLine)) {
      foundV3Condition = true;
    }

    // 檢查完整上下文是否包含這些模式（支持跨行）
    if (
      !foundV4Condition &&
      fullContext.match(v4Pattern) &&
      changedLine.includes("formatClasses")
    ) {
      // 檢查改動行是否在匹配的模式內
      const match = fullContext.match(v4Pattern);
      if (match) {
        const matchIndex = fullContext.indexOf(match[0]);
        const changedIndex = fullContext.indexOf(changedLine);
        // 如果改動行在匹配的模式附近（前後 50 個字符），認為在該條件塊內
        if (Math.abs(changedIndex - matchIndex) < 200) {
          foundV4Condition = true;
        }
      }
    }
    if (
      !foundV3Condition &&
      fullContext.match(v3Pattern) &&
      changedLine.includes("formatClasses")
    ) {
      const match = fullContext.match(v3Pattern);
      if (match) {
        const matchIndex = fullContext.indexOf(match[0]);
        const changedIndex = fullContext.indexOf(changedLine);
        if (Math.abs(changedIndex - matchIndex) < 200) {
          foundV3Condition = true;
        }
      }
    }

    // 優化：檢查是否只是「恢復原樣」的情況
    // 如果改動是從無版本條件改為有版本條件，且值保持不變，則不影響對應版本
    let isV3Restore = false;
    let isV4Restore = false;

    if (foundV3Condition && changed.pairedContent) {
      // 檢查改動前的內容（pairedContent）是否包含相同的值
      // 例如：改動前是 `[colors.fill.Text.primary]: isActive()`
      // 改動後是 `[formatClasses({ [colors.fill.Block.primary]: isActive() })]: isV3()`
      // 如果改動前的值在 v3 下本來就是 Block.primary，則只是恢復原樣
      const oldContent = changed.pairedContent.trim();
      const newContent = changedLine;

      // 提取改動前的顏色值
      const oldColorMatch = oldContent.match(
        /colors\.(fill|text|border|background|stroke)\.[\w.]+/
      );
      // 提取改動後的 v3 條件內的顏色值
      const v3ColorMatch = newContent.match(
        /colors\.(fill|text|border|background|stroke)\.[\w.]+/
      );

      // 如果改動前沒有版本條件，改動後添加了 isV3() 條件
      // 且改動前的值在 v3 下本來就是 Block.primary（v3 的默認值），則只是恢復原樣
      if (!oldContent.includes("isV3()") && !oldContent.includes("isV4()")) {
        // 改動前沒有版本條件，可能同時影響 v3 和 v4
        // 如果改動後明確指定了 v3 條件，且值是 Block.primary（v3 的默認值），則不影響 v3
        if (v3ColorMatch && v3ColorMatch[0].includes("Block.primary")) {
          isV3Restore = true;
        }
      }
    }

    if (foundV4Condition && changed.pairedContent) {
      const oldContent = changed.pairedContent.trim();
      const newContent = changedLine;

      // 類似地檢查 v4 的情況
      if (!oldContent.includes("isV3()") && !oldContent.includes("isV4()")) {
        // 改動前沒有版本條件，改動後明確指定了 v4 條件
        // 如果值是 Text.primary（v4 的新值），則影響 v4
        // 如果值是 Block.primary（v3 的舊值），則不影響 v4
        const v4ColorMatch = newContent.match(
          /colors\.(fill|text|border|background|stroke)\.[\w.]+/
        );
        if (v4ColorMatch && v4ColorMatch[0].includes("Block.primary")) {
          isV4Restore = true;
        }
      }
    }

    // 檢查是否在 SystemLayoutContainer 的 children slot 中（v3 的內容）
    // 如果改動是在 children slot 中，且只是恢復原值，則不影響 v3
    const isInChildrenSlot =
      fullContext.includes("SystemLayoutContainer") &&
      !fullContext.includes("v4Slot") &&
      fullContext.includes("children");

    // 如果還沒有找到版本條件，檢查是否在三元運算符或條件塊內
    // 例如: isV4() ? [...] : [...] 或 if (isV4()) { ... }
    if (!foundV4Condition && !foundV3Condition) {
      // 擴大上下文範圍以更好地檢測三元運算符和條件塊（前後 30 行）
      const expandedStartLine = Math.max(0, lineNum - 31);
      const expandedEndLine = Math.min(fileLines.length, lineNum + 30);
      const expandedContextLines = fileLines.slice(
        expandedStartLine,
        expandedEndLine
      );

      // 檢測三元運算符模式: isV4() ? [...] : [...] 或 isV3() ? [...] : [...]
      // 使用行號來判斷改動行是否在 true 分支內
      for (let i = 0; i < expandedContextLines.length; i++) {
        const line = expandedContextLines[i];
        const actualLineNum = expandedStartLine + i + 1;

        // 檢查 isV4() 三元運算符（isV4() 和 ? 可能不在同一行）
        if (line.includes("isV4()")) {
          // 查找對應的 ?（可能在當前行或後續幾行內）
          let questionMarkLineNum = -1;
          for (
            let j = i;
            j < Math.min(expandedContextLines.length, i + 5);
            j++
          ) {
            if (expandedContextLines[j].includes("?")) {
              questionMarkLineNum = expandedStartLine + j + 1;
              break;
            }
          }
          if (questionMarkLineNum === -1) continue;
          // 找到對應的 : 位置（在同一行或後續行）
          let colonLineNum = -1;
          let depth = 0;
          let inString = false;
          let stringChar = null;

          // 從 ? 之後開始查找對應的 :
          const questionMarkLineIndex =
            questionMarkLineNum - expandedStartLine - 1;
          const questionMarkLine = expandedContextLines[questionMarkLineIndex];
          let searchStart = questionMarkLine.indexOf("?") + 1;
          let currentLine = questionMarkLine.substring(searchStart);
          let currentLineNum = questionMarkLineNum;

          for (
            let j = questionMarkLineIndex;
            j < expandedContextLines.length;
            j++
          ) {
            const searchLine =
              j === questionMarkLineIndex
                ? currentLine
                : expandedContextLines[j];
            currentLineNum = expandedStartLine + j + 1;

            for (let k = 0; k < searchLine.length; k++) {
              const char = searchLine[k];
              const prevChar = k > 0 ? searchLine[k - 1] : "";

              // 處理字符串
              if (!inString && (char === '"' || char === "'" || char === "`")) {
                inString = true;
                stringChar = char;
              } else if (inString && char === stringChar && prevChar !== "\\") {
                inString = false;
                stringChar = null;
              }

              if (!inString) {
                if (char === "(" || char === "[" || char === "{") {
                  depth++;
                } else if (char === ")" || char === "]" || char === "}") {
                  depth--;
                } else if (char === ":" && depth === 0) {
                  colonLineNum = currentLineNum;
                  break;
                }
              }
            }

            if (colonLineNum !== -1) break;
            depth = 0; // 重置深度，因為換行了
          }

          // 如果找到對應的 :，且改動行在 ? 和 : 之間，則在 v4 分支內
          if (
            colonLineNum !== -1 &&
            lineNum > questionMarkLineNum &&
            lineNum < colonLineNum
          ) {
            foundV4Condition = true;
            break;
          }
        }

        // 檢查 isV3() 三元運算符（isV3() 和 ? 可能不在同一行）
        if (line.includes("isV3()")) {
          // 查找對應的 ?（可能在當前行或後續幾行內）
          let questionMarkLineNum = -1;
          for (
            let j = i;
            j < Math.min(expandedContextLines.length, i + 5);
            j++
          ) {
            if (expandedContextLines[j].includes("?")) {
              questionMarkLineNum = expandedStartLine + j + 1;
              break;
            }
          }
          if (questionMarkLineNum === -1) continue;
          let colonLineNum = -1;
          let depth = 0;
          let inString = false;
          let stringChar = null;

          const questionMarkLineIndex =
            questionMarkLineNum - expandedStartLine - 1;
          const questionMarkLine = expandedContextLines[questionMarkLineIndex];
          let searchStart = questionMarkLine.indexOf("?") + 1;
          let currentLine = questionMarkLine.substring(searchStart);
          let currentLineNum = questionMarkLineNum;

          for (
            let j = questionMarkLineIndex;
            j < expandedContextLines.length;
            j++
          ) {
            const searchLine =
              j === questionMarkLineIndex
                ? currentLine
                : expandedContextLines[j];
            currentLineNum = expandedStartLine + j + 1;

            for (let k = 0; k < searchLine.length; k++) {
              const char = searchLine[k];
              const prevChar = k > 0 ? searchLine[k - 1] : "";

              if (!inString && (char === '"' || char === "'" || char === "`")) {
                inString = true;
                stringChar = char;
              } else if (inString && char === stringChar && prevChar !== "\\") {
                inString = false;
                stringChar = null;
              }

              if (!inString) {
                if (char === "(" || char === "[" || char === "{") {
                  depth++;
                } else if (char === ")" || char === "]" || char === "}") {
                  depth--;
                } else if (char === ":" && depth === 0) {
                  colonLineNum = currentLineNum;
                  break;
                }
              }
            }

            if (colonLineNum !== -1) break;
            depth = 0;
          }

          if (
            colonLineNum !== -1 &&
            lineNum > questionMarkLineNum &&
            lineNum < colonLineNum
          ) {
            foundV3Condition = true;
            break;
          }
        }
      }
    }

    // 如果找到版本條件，標記對應版本（但排除「恢復原樣」的情況）
    if (foundV4Condition && !foundV3Condition && !isV4Restore) {
      impact.v4 = true;
    } else if (
      foundV3Condition &&
      !foundV4Condition &&
      !isV3Restore &&
      !isInChildrenSlot
    ) {
      // 如果是在 children slot 中且只是恢復原值，不影響 v3
      impact.v3 = true;
    } else if (foundV4Condition && foundV3Condition) {
      // 如果同時找到兩個條件，需要更仔細判斷
      // 檢查改動行更接近哪個條件
      const v4Distance = Math.min(
        ...contextLines
          .map((line, idx) =>
            line.includes("isV4()")
              ? Math.abs(startLine + idx + 1 - lineNum)
              : Infinity
          )
          .filter((d) => d !== Infinity)
      );
      const v3Distance = Math.min(
        ...contextLines
          .map((line, idx) =>
            line.includes("isV3()")
              ? Math.abs(startLine + idx + 1 - lineNum)
              : Infinity
          )
          .filter((d) => d !== Infinity)
      );

      if (v4Distance < v3Distance && !isV4Restore) {
        impact.v4 = true;
      } else if (v3Distance < v4Distance && !isV3Restore && !isInChildrenSlot) {
        impact.v3 = true;
      } else if (v4Distance === v3Distance) {
        // 距離相等，根據是否恢復原樣來判斷
        if (!isV4Restore) impact.v4 = true;
        if (!isV3Restore && !isInChildrenSlot) impact.v3 = true;
      }
    }
  }

  // 如果有 formatClasses 的比較結果，使用比較結果來驗證和修正影響範圍
  if (formatClassesChanges.length > 0) {
    // 重新計算影響範圍，基於實際效果比較
    const finalImpact = { v3: false, v4: false };
    for (const comp of formatClassesChanges) {
      if (comp.v3) finalImpact.v3 = true;
      if (comp.v4) finalImpact.v4 = true;
    }
    // 如果比較結果顯示某個版本沒有實際影響，則不標記
    // 但保留其他非 formatClasses 相關的改動影響
    if (finalImpact.v3 || finalImpact.v4) {
      // 使用比較結果覆蓋原有標記
      // 如果比較結果顯示沒有影響，即使原有邏輯標記了，也不標記
      impact.v3 = finalImpact.v3;
      impact.v4 = finalImpact.v4;
    } else {
      // 如果比較結果顯示兩個版本都沒有實際影響，但原有邏輯標記了
      // 這可能是因為只是為了明確性添加的條件，實際效果沒變
      // 在這種情況下，如果只有 formatClasses 相關的改動，則不標記任何版本
      const hasOnlyFormatClassesChanges = changedLines.every(
        (changed) =>
          changed.content.includes("formatClasses") ||
          changed.content.includes("isV3()") ||
          changed.content.includes("isV4()")
      );
      if (hasOnlyFormatClassesChanges) {
        impact.v3 = false;
        impact.v4 = false;
      }
    }
  }

  return impact;
}

// 分析檔案內容判斷影響範圍
function analyzeFileImpact(filePath, context = {}) {
  const {
    hasOnlyV3 = false,
    hasOnlyV4 = false,
    isSharedFile = false,
    targetBranch = "main",
  } = context;
  const impact = {
    v3: false,
    v4: false,
  };

  try {
    // 讀取檔案內容
    const content = readFileSync(filePath, "utf-8");

    // 優先檢查檔案開頭是否包含版本標記（檢查前 100 行）
    const lines = content.split("\n");
    const headerLines = lines.slice(0, 100).join("\n").toLowerCase();

    // 檢查是否包含 "v3 only" 或 "v4 only" 標記
    if (headerLines.match(/v3\s+only|v3-only/)) {
      impact.v3 = true;
      impact.v4 = false;
      return impact; // 明確標記，直接返回
    }
    if (headerLines.match(/v4\s+only|v4-only/)) {
      impact.v3 = false;
      impact.v4 = true;
      return impact; // 明確標記，直接返回
    }

    // 檢查檔案路徑模式（這是明確的版本標記，優先級最高）
    if (filePath.includes(".v3.") || filePath.includes("/v3/")) {
      impact.v3 = true;
    }
    if (filePath.includes(".v4.") || filePath.includes("/v4/")) {
      impact.v4 = true;
    }

    // 如果檔案路徑已經有明確的版本標記，直接返回
    if (impact.v3 || impact.v4) {
      return impact;
    }

    // 對於沒有明確版本標記的檔案，優先使用 git diff 分析實際改動內容
    // 這能確保分析的是最終狀態的改動，而不是整個檔案的內容
    const diffContent = getFileDiff(filePath, targetBranch);
    if (diffContent && diffContent.length > 0) {
      const diffImpact = analyzeDiffImpact(diffContent, content);
      // 如果 diff 分析能夠確定影響範圍，優先使用 diff 結果（這是最終狀態的改動）
      if (diffImpact.v3 || diffImpact.v4) {
        // diff 分析結果代表最終狀態的改動，應該優先使用
        if (diffImpact.v3 && !diffImpact.v4) {
          // 只影響 v3
          return { v3: true, v4: false };
        } else if (diffImpact.v4 && !diffImpact.v3) {
          // 只影響 v4
          return { v3: false, v4: true };
        } else if (diffImpact.v3 && diffImpact.v4) {
          // 同時影響兩個版本
          return { v3: true, v4: true };
        }
      }
      // 如果 diff 分析沒有明確結果，但檔案有改動，應該只根據實際改動部分判斷
      // 不應該因為檔案中包含 v3/v4 相關代碼就標記為影響該版本
      // 這種情況下，應該根據上下文（hasOnlyV3/hasOnlyV4）來判斷
    }

    // 只有在 diff 分析無法確定，且檔案路徑沒有明確版本標記時，才檢查檔案內容標記
    // 但對於共享檔案，應該優先使用 diff 分析的結果，而不是整個檔案的內容
    // 因為檔案可能包含 v3 和 v4 的代碼，但實際改動可能只影響其中一個版本
    if (!impact.v3 && !impact.v4) {
      // 檢查檔案內容標記（僅作為輔助判斷，不應該覆蓋 diff 分析的結果）
      if (
        content.includes("SystemLayout.Asia") ||
        content.includes("isV3()") ||
        content.match(/!\[3\.0\]/)
      ) {
        impact.v3 = true;
      }
      if (
        content.includes("SystemLayout.International") ||
        content.includes("isV4()") ||
        content.match(/!\[4\.0\]/) ||
        content.includes("!4.0UI")
      ) {
        impact.v4 = true;
      }
    }

    // 如果包含 SystemLayoutContainer，可能影響兩個版本
    if (content.includes("SystemLayoutContainer")) {
      // 檢查是否有明確的版本標記
      if (!impact.v3 && !impact.v4) {
        // 如果沒有明確標記，檢查是否有 v4Slot
        if (content.includes("v4Slot")) {
          impact.v3 = true; // v4Slot 存在表示有 v3 的 fallback
          impact.v4 = true;
        } else {
          // 預設兩個版本都影響
          impact.v3 = true;
          impact.v4 = true;
        }
      }
    }

    // 如果檔案在 shared 或 utilities，可能影響兩個版本
    if (
      (filePath.includes("src/shared/") ||
        filePath.includes("src/utilities/")) &&
      !impact.v3 &&
      !impact.v4
    ) {
      // 如果所有有版本標記的檔案都是同一個版本，共享檔案應該只影響那個版本
      if (hasOnlyV3) {
        impact.v3 = true;
        impact.v4 = false;
      } else if (hasOnlyV4) {
        impact.v3 = false;
        impact.v4 = true;
      } else {
        // 混合版本或沒有版本標記，預設影響兩個版本
        impact.v3 = true;
        impact.v4 = true;
      }
    }
  } catch (error) {
    // 如果無法讀取檔案，根據路徑判斷
    if (filePath.includes(".v3.") || filePath.includes("/v3/")) {
      impact.v3 = true;
    }
    if (filePath.includes(".v4.") || filePath.includes("/v4/")) {
      impact.v4 = true;
    }
    // 如果無法判斷，根據上下文決定
    if (!impact.v3 && !impact.v4) {
      if (hasOnlyV3) {
        impact.v3 = true;
        impact.v4 = false;
      } else if (hasOnlyV4) {
        impact.v3 = false;
        impact.v4 = true;
      } else {
        // 預設兩個版本都影響（保守策略）
        impact.v3 = true;
        impact.v4 = true;
      }
    }
  }

  return impact;
}

// 分析所有改動檔案的影響範圍
function analyzeImpactScope(changedFiles) {
  const impact = {
    v3: false,
    v4: false,
  };

  // 先分類所有檔案，找出有明確版本標記的檔案
  const versionSpecificFiles = {
    v3: [],
    v4: [],
    shared: [],
  };

  for (const file of changedFiles) {
    const filePath = join(projectRoot, file);

    // 檢查檔案是否有明確的版本標記（通過路徑或第一行註釋）
    const hasV3Marker = filePath.includes(".v3.") || filePath.includes("/v3/");
    const hasV4Marker = filePath.includes(".v4.") || filePath.includes("/v4/");

    if (hasV3Marker) {
      versionSpecificFiles.v3.push(file);
    } else if (hasV4Marker) {
      versionSpecificFiles.v4.push(file);
    } else {
      // 檢查第一行是否有版本標記
      try {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const firstLine = lines[0]?.toLowerCase() || "";
        if (firstLine.match(/v3\s+only|v3-only/)) {
          versionSpecificFiles.v3.push(file);
        } else if (firstLine.match(/v4\s+only|v4-only/)) {
          versionSpecificFiles.v4.push(file);
        } else {
          versionSpecificFiles.shared.push(file);
        }
      } catch (error) {
        versionSpecificFiles.shared.push(file);
      }
    }
  }

  // 如果所有有版本標記的檔案都是同一個版本，共享檔案應該只影響那個版本
  const hasV3Specific = versionSpecificFiles.v3.length > 0;
  const hasV4Specific = versionSpecificFiles.v4.length > 0;
  const hasOnlyV3 = hasV3Specific && !hasV4Specific;
  const hasOnlyV4 = hasV4Specific && !hasV3Specific;

  // 獲取目標分支（用於 diff 分析）
  let targetBranch = "main";
  try {
    const args = process.argv.slice(2);
    const targetBranchArg = args.find(
      (arg) => arg.startsWith("--target-branch=") || arg.startsWith("--target=")
    );
    if (targetBranchArg) {
      targetBranch = targetBranchArg.split("=")[1];
    }
  } catch (error) {
    // 使用預設值
  }

  // 使用上下文分析所有檔案的影響範圍
  for (const file of changedFiles) {
    const filePath = join(projectRoot, file);
    const fileImpact = analyzeFileImpact(filePath, {
      hasOnlyV3,
      hasOnlyV4,
      isSharedFile: versionSpecificFiles.shared.includes(file),
      targetBranch,
    });
    if (fileImpact.v3) impact.v3 = true;
    if (fileImpact.v4) impact.v4 = true;
  }

  return impact;
}

// 檢查改動檔案是否有特定版本標記
function hasSpecificVersionMarkers(changedFiles) {
  for (const file of changedFiles) {
    const filePath = join(projectRoot, file);
    const filePathLower = filePath.toLowerCase();
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const headerLines = lines.slice(0, 100).join("\n").toLowerCase();

      // 檢查是否有明確的版本標記
      if (headerLines.match(/v3\s+only|v3-only/)) {
        return true;
      }
      if (headerLines.match(/v4\s+only|v4-only/)) {
        return true;
      }

      // 檢查檔案路徑模式（不區分大小寫）
      // 匹配: .v3. 或 /v3/ 或檔案名/目錄名中包含 V3（如 SideMenuV3, index.v3.tsx, /v3/component.tsx）
      const pathParts = filePath.split(/[\/\\]/);
      const hasV3InPath = pathParts.some((part) => /^.*v3.*$/i.test(part));
      const hasV4InPath = pathParts.some((part) => /^.*v4.*$/i.test(part));

      if (
        filePathLower.includes(".v3.") ||
        filePathLower.includes("/v3/") ||
        hasV3InPath
      ) {
        return true;
      }
      // 匹配: .v4. 或 /v4/ 或檔案名/目錄名中包含 V4（如 SideMenuV4, index.v4.tsx, /v4/component.tsx）
      if (
        filePathLower.includes(".v4.") ||
        filePathLower.includes("/v4/") ||
        hasV4InPath
      ) {
        return true;
      }
    } catch (error) {
      // 如果無法讀取檔案，根據路徑判斷（不區分大小寫）
      const pathParts = filePath.split(/[\/\\]/);
      const hasV3InPath = pathParts.some((part) => /^.*v3.*$/i.test(part));
      const hasV4InPath = pathParts.some((part) => /^.*v4.*$/i.test(part));

      if (
        filePathLower.includes(".v3.") ||
        filePathLower.includes("/v3/") ||
        hasV3InPath
      ) {
        return true;
      }
      if (
        filePathLower.includes(".v4.") ||
        filePathLower.includes("/v4/") ||
        hasV4InPath
      ) {
        return true;
      }
    }
  }
  return false;
}

// 檢查 Jira ticket 是否存在
async function checkJiraTicketExists(ticket) {
  if (!ticket || ticket === "N/A") {
    return { exists: false, error: null };
  }

  // 獲取 Jira 配置（如果配置缺失，getJiraConfig 會引導用戶設置並拋出錯誤）
  let config;
  try {
    config = getJiraConfig();
  } catch (error) {
    // 配置缺失，返回 false 但不拋出錯誤（讓調用者決定如何處理）
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

    // 如果成功獲取到數據，說明 ticket 存在
    return { exists: true, error: null };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

// 獲取 Jira ticket 的 fix version
async function getJiraFixVersion(ticket) {
  if (!ticket || ticket === "N/A") {
    return null;
  }

  // 獲取 Jira 配置（如果配置缺失，getJiraConfig 會引導用戶設置並拋出錯誤）
  let config;
  try {
    config = getJiraConfig();
  } catch (error) {
    // 配置缺失，已經在 getJiraConfig 中引導用戶設置
    console.log(
      `⚠️  無法獲取 ticket ${ticket} 的 fix version：${error.message}\n`
    );
    return null;
  }

  if (!config || !config.email || !config.apiToken) {
    console.log(
      `⚠️  未設置 Jira API 認證信息，無法獲取 ticket ${ticket} 的 fix version\n`
    );
    guideJiraConfig();
    return null;
  }

  try {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64"
    );
    // 確保 baseUrl 以 / 結尾，但 rest/api 前不需要重複的 /
    const baseUrl = config.baseUrl.endsWith("/")
      ? config.baseUrl.slice(0, -1)
      : config.baseUrl;
    const url = `${baseUrl}/rest/api/3/issue/${ticket}`;
    console.log(`🔍 正在從 Jira 獲取 ticket ${ticket} 的 fix version...`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`⚠️  找不到 Jira ticket: ${ticket}\n`);
      } else if (response.status === 401 || response.status === 403) {
        // Token 過期或無權限
        console.log(
          `\n❌ Jira API Token 已過期或無權限 (${response.status})\n`
        );
        console.log(`   請聯繫最高管理員: william.chiang\n`);
        throw new Error("Jira API Token 已過期，請聯繫 william.chiang");
      } else {
        console.log(
          `⚠️  獲取 Jira ticket ${ticket} 信息失敗: ${response.status} ${response.statusText}\n`
        );
      }
      return null;
    }

    const data = await response.json();
    const fixVersions = data.fields?.fixVersions || [];

    if (fixVersions.length === 0) {
      console.log(`ℹ️  Jira ticket ${ticket} 沒有設置 fix version\n`);
      return null;
    }

    // 返回第一個 fix version（通常只有一個）
    const fixVersion = fixVersions[0].name;
    console.log(
      `✅ 成功獲取 Jira ticket ${ticket} 的 fix version: ${fixVersion}\n`
    );
    return fixVersion;
  } catch (error) {
    // 如果是 token 過期錯誤，已經在上面處理了，這裡只處理其他錯誤
    if (error.message && error.message.includes("Jira API Token")) {
      throw error; // 重新拋出 token 過期錯誤
    }
    console.log(
      `⚠️  獲取 Jira ticket ${ticket} 的 fix version 失敗: ${error.message}\n`
    );
    return null;
  }
}

// 從 fix version 提取版本 label（例如：5.35.0 -> v5.35, 5.35.3 -> v5.35）
function extractVersionLabel(fixVersion) {
  if (!fixVersion) {
    return null;
  }

  // 匹配版本格式：major.minor.patch 或 major.minor
  const match = fixVersion.match(/^(\d+)\.(\d+)(?:\.\d+)?/);
  if (match) {
    const major = match[1];
    const minor = match[2];
    return `v${major}.${minor}`;
  }

  return null;
}

// 從 fix version 提取 release branch 名稱（例如：5.35.1 -> release/5.35）
function extractReleaseBranch(fixVersion) {
  if (!fixVersion) {
    return null;
  }

  // 匹配版本格式：major.minor.patch 或 major.minor
  const match = fixVersion.match(/^(\d+)\.(\d+)(?:\.\d+)?/);
  if (match) {
    const major = match[1];
    const minor = match[2];
    return `release/${major}.${minor}`;
  }

  return null;
}

// 檢查 fix version 是否為 hotfix（最後數字非 0）
function isHotfixVersion(fixVersion) {
  if (!fixVersion) {
    return false;
  }

  // 匹配版本格式：major.minor.patch
  const match = fixVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (match) {
    const patch = parseInt(match[3], 10);
    return patch !== 0;
  }

  return false;
}

// 讀取 start-task 開發計劃（從 Git notes）
function readStartTaskInfo() {
  try {
    // 首先嘗試讀取當前 HEAD 的 Git notes
    const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();
    try {
      const noteContent = exec(
        `git notes --ref=start-task show ${currentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // 當前 commit 沒有 Git notes，繼續嘗試其他位置
    }

    // 嘗試從父 commit 讀取
    try {
      const parentCommit = exec("git rev-parse HEAD^", { silent: true }).trim();
      const noteContent = exec(
        `git notes --ref=start-task show ${parentCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        // 複製到當前 commit 以便後續使用
        try {
          const result = spawnSync(
            "git",
            [
              "notes",
              "--ref=start-task",
              "add",
              "-f",
              "-F",
              "-",
              currentCommit,
            ],
            {
              cwd: projectRoot,
              input: noteContent,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            }
          );

          if (result.status === 0) {
            console.log(
              "💡 已從父 commit 複製 start-task Git notes 到當前 commit\n"
            );
          }
        } catch (copyError) {
          // 複製失敗不影響讀取，繼續執行
        }
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // 父 commit 沒有 Git notes，繼續嘗試
    }

    // 嘗試從分支的 base commit 讀取
    try {
      const baseCommit = exec("git merge-base HEAD main", {
        silent: true,
      }).trim();
      const noteContent = exec(
        `git notes --ref=start-task show ${baseCommit}`,
        { silent: true }
      ).trim();
      if (noteContent) {
        // 複製到當前 commit 以便後續使用
        try {
          const result = spawnSync(
            "git",
            [
              "notes",
              "--ref=start-task",
              "add",
              "-f",
              "-F",
              "-",
              currentCommit,
            ],
            {
              cwd: projectRoot,
              input: noteContent,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            }
          );

          if (result.status === 0) {
            console.log(
              "💡 已從 base commit 複製 start-task Git notes 到當前 commit\n"
            );
          }
        } catch (copyError) {
          // 複製失敗不影響讀取，繼續執行
        }
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // base commit 沒有 Git notes
    }

    return null;
  } catch (error) {
    // Git notes 不存在或無法讀取，返回 null
    return null;
  }
}

// 根據影響範圍決定 labels
async function determineLabels(impact, ticket, changedFiles) {
  const labels = [];
  let releaseBranch = null;

  // 檢查是否由 start-task 啟動（透過標記文件）
  const startTaskInfo = readStartTaskInfo();
  if (startTaskInfo) {
    labels.push("AI");
    console.log("🤖 檢測到由 start-task 啟動，將添加 AI label\n");
  }

  // 檢查改動檔案是否有特定版本標記
  // 優先使用 impact 分析結果（包含 diff 分析），如果 impact 有明確的版本標記，則使用 impact
  // 否則檢查檔案路徑和註釋標記
  const hasSpecificMarkers =
    changedFiles.length > 0 && hasSpecificVersionMarkers(changedFiles);
  const hasImpactMarkers = impact.v3 || impact.v4; // impact 分析結果（包含 diff 分析）

  if (hasImpactMarkers) {
    // 優先使用 impact 分析結果（包含 diff 分析，能檢測到 isV4() 等代碼條件）
    if (impact.v3 && impact.v4) {
      labels.push("3.0UI");
      labels.push("4.0UI");
    } else if (impact.v3) {
      labels.push("3.0UI");
    } else if (impact.v4) {
      labels.push("4.0UI");
    }
  } else if (hasSpecificMarkers) {
    // 有檔案路徑或註釋標記，根據影響範圍添加
    if (impact.v3 && impact.v4) {
      labels.push("3.0UI");
      labels.push("4.0UI");
    } else if (impact.v3) {
      labels.push("3.0UI");
    } else if (impact.v4) {
      labels.push("4.0UI");
    }
  } else {
    // 沒有特定版本標記，同時影響 v3/v4
    labels.push("3.0UI");
    labels.push("4.0UI");
  }

  // 如果 Jira ticket 開頭是 FE，添加 FE Board label
  if (ticket && ticket.startsWith("FE-")) {
    labels.push("FE Board");
  }

  // 獲取 Jira ticket 的 fix version 並添加版本 label
  if (ticket && ticket !== "N/A") {
    try {
      const fixVersion = await getJiraFixVersion(ticket);
      if (fixVersion) {
        console.log(`📋 Jira ticket ${ticket} 的 fix version: ${fixVersion}`);
        const versionLabel = extractVersionLabel(fixVersion);
        if (versionLabel) {
          console.log(`   → 提取版本 label: ${versionLabel}`);
          labels.push(versionLabel);
        }

        // 如果 fix version 最後數字非 0，添加 Hotfix label
        if (isHotfixVersion(fixVersion)) {
          console.log(`   → 檢測到 Hotfix 版本，將添加 Hotfix label`);
          labels.push("Hotfix");
          // 提取對應的 release branch
          releaseBranch = extractReleaseBranch(fixVersion);
        }
        console.log("");
      }
    } catch (error) {
      // Token 過期錯誤已在 getJiraFixVersion 中處理並顯示提示
      // 這裡只記錄錯誤，不中斷流程
      if (error.message && error.message.includes("Jira API Token")) {
        // Token 過期，不添加版本 label，但繼續執行其他邏輯
      }
    }
  }

  return { labels, releaseBranch };
}

// 查找用戶 ID
async function findUserId(token, host, username) {
  try {
    // 移除 @ 符號（如果有的話）
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

// 注意：reviewer 選擇現在在 Cursor chat 中進行，不再使用終端互動

// 從 description 中提取 Jira ticket 號碼
function extractJiraTickets(description) {
  if (!description) return [];

  // 提取所有符合格式的 ticket（FE-1234, IN-1234 等）
  const ticketPattern = /([A-Z0-9]+-\d+)/g;
  const matches = description.match(ticketPattern);

  if (!matches) return [];

  // 去重並排序
  return [...new Set(matches)].sort();
}

// 生成 Jira ticket 的短連結
function generateJiraLink(ticket) {
  // Jira base URL 固定為 innotech
  return `https://innotech.atlassian.net/browse/${ticket}`;
}

// 格式化 Jira tickets 為超連結格式（Markdown）
function formatJiraTicketsAsLinks(tickets) {
  if (!tickets || tickets.length === 0) return "";

  const links = tickets.map(
    (ticket) => `[${ticket}](${generateJiraLink(ticket)})`
  );
  // 使用 " , " 分隔符，與 MR description 格式一致
  return links.join(" , ");
}

// 檢查錯誤訊息是否與 Cursor rules 違規相關
function isCursorRulesViolation(errorMessage) {
  if (!errorMessage) return false;

  const lowerMessage = errorMessage.toLowerCase();

  // 檢測 Cursor rules 相關的錯誤關鍵字
  const violationKeywords = [
    "cursor rule",
    "cursor rules",
    "architecture violation",
    "architectural violation",
    "state management",
    "provider.*side effect",
    "api call.*provider",
    "critical issue",
    "🚨",
    "violation",
    "違反",
    "architecture.*forbidden",
    "forbidden.*pattern",
  ];

  return violationKeywords.some((keyword) => {
    const regex = new RegExp(keyword, "i");
    return regex.test(lowerMessage);
  });
}

// 獲取 GitLab user email（優先使用 glab，其次 API）
async function getGitLabUserEmail(hostname = "gitlab.service-hub.tech") {
  // 方法 1: 嘗試使用 glab 獲取用戶信息
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
      // glab 獲取失敗，繼續嘗試其他方法
    }
  }

  // 方法 2: 嘗試使用 API token 獲取用戶信息
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

// 獲取當前 GitLab 用戶 ID（用於設置 assignee）
async function getGitLabUserId(hostname = "gitlab.service-hub.tech") {
  // 方法 1: 嘗試使用 glab 獲取用戶信息
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
      // glab 獲取失敗，繼續嘗試其他方法
    }
  }

  // 方法 2: 嘗試使用 API token 獲取用戶信息
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

// 檢查必要的配置並引導用戶設置（用於 AI review）
function checkAndGuideConfigForAIReview() {
  const missingConfigs = [];
  const guides = [];

  // 檢查 Compass API token（必需）
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

  // 檢查 GitLab token（用於獲取 email）
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
    // 檢查失敗，視為缺少配置
    if (!missingConfigs.includes("GitLab Token")) {
      missingConfigs.push("GitLab Token");
    }
  }

  // 檢查 Jira email（備用方案）
  const jiraEmail = getJiraEmail();
  if (!jiraEmail) {
    // 只有在 GitLab token 也缺失時才標記為錯誤
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

// 獲取 AI review 提交時使用的 email（優先級：GitLab user email > Jira email > 引導用戶）
async function getAIReviewEmail() {
  // 優先級 1: GitLab user email
  const gitlabEmail = await getGitLabUserEmail();
  if (gitlabEmail) {
    return gitlabEmail;
  }

  // 優先級 2: Jira email
  const jiraEmail = getJiraEmail();
  if (jiraEmail) {
    return jiraEmail;
  }

  // 優先級 3: 引導用戶設置
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
  // 檢查配置
  if (!checkAndGuideConfigForAIReview()) {
    throw new Error(
      "配置不完整，請先設置必要的配置（Compass API token、GitLab token 或 Jira email）"
    );
  }

  // 獲取 Compass API token
  const apiKey = getCompassApiToken();
  if (!apiKey) {
    throw new Error("無法獲取 Compass API token，請設置 COMPASS_API_TOKEN");
  }

  // 獲取 email
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
      email: email, // 添加 email 參數
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

  // CRITICAL: 已存在的 MR title 不可異動，不更新 title
  // if (title) {
  //   body.title = draft ? `Draft: ${title}` : title;
  // }

  if (description) {
    body.description = description;
  }

  body.work_in_progress = draft;

  // CRITICAL: 只有在 shouldUpdateReviewer 為 true 時才更新 reviewer
  if (shouldUpdateReviewer && reviewerId) {
    body.reviewer_ids = [reviewerId];
  }

  if (labels && labels.length > 0) {
    body.add_labels = labels.join(",");
  }

  // 預設設定 delete source branch
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
    title: draft ? `Draft: ${title}` : title, // GitLab 也支持在標題前加 "Draft:" 前綴
    description,
    work_in_progress: draft, // 使用 work_in_progress 參數
    remove_source_branch: true, // 合併後刪除來源分支
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

  // 預設設定 delete source branch
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
      // 檢查是否是因為已存在 MR
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

async function main() {
  const args = process.argv.slice(2);
  const targetBranchArg = args.find((arg) => arg.startsWith("--target="));
  const userExplicitlySetTarget = !!targetBranchArg; // 用戶是否明確指定了 target branch
  let targetBranch = targetBranchArg?.split("=")[1] || "main";
  const draft = !args.includes("--no-draft");

  // 檢查是否有未提交的變更（必須先 commit 才能建立 MR）
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

  // 獲取當前分支（提前獲取，後續會重用）
  let currentBranch = getCurrentBranch();

  // 檢查遠端分支是否存在（必須先推送到遠端才能建立 MR）
  let remoteBranchExists = false;
  try {
    const result = exec(`git ls-remote --heads origin ${currentBranch}`, {
      silent: true,
    });
    // 檢查輸出結果是否為空，如果為空表示分支不存在
    // git ls-remote 在分支存在時會返回類似 "hash\trefs/heads/branch-name" 的結果
    remoteBranchExists = result && result.trim().length > 0;
  } catch (error) {
    // 命令執行失敗，視為分支不存在
    remoteBranchExists = false;
  }

  if (!remoteBranchExists) {
    console.error("\n❌ 遠端分支不存在，無法建立 MR\n");
    console.error(`📋 當前分支: ${currentBranch}`);
    console.error("⚠️  必須先推送分支到遠端才能建立 MR\n");
    process.exit(1);
  }

  // ============================================================================
  // CRITICAL: Pre-MR Rebase Requirement
  // 根據 commit-and-mr-guidelines.mdc 規則，建立 MR 前必須 rebase 到目標分支
  // ============================================================================

  // 檢查是否正在進行 rebase（可能是之前中斷的）
  if (isRebaseInProgress()) {
    console.error("\n❌ 檢測到有未完成的 rebase，無法建立 MR\n");
    console.error("⚠️  請先完成或中止 rebase：");
    console.error("   - 繼續: git rebase --continue");
    console.error("   - 中止: git rebase --abort\n");
    process.exit(1);
  }

  // 執行 rebase 到目標分支
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

  // CRITICAL: 檢查是否有未推送的 commits（Pre-MR Push Requirement）
  // rebase 後可能會有新的 commits 需要推送（rebase 會重寫 commit history）
  // 根據 commit-and-mr-guidelines.mdc 規則，建立 MR 前所有 commits 必須推送到遠端
  //
  // 注意：rebase 後需要使用 --force-with-lease 來推送，因為 commit history 已被重寫
  // --force-with-lease 比 --force 更安全，它會檢查遠端分支是否被其他人更新過

  // 先檢查本地與遠端的 commit 是否不同（rebase 後 commit hash 會改變）
  let needsForceWithLease = false;
  try {
    // 獲取本地 HEAD 的 commit hash
    const localHead = exec("git rev-parse HEAD", { silent: true }).trim();
    // 獲取遠端分支的 commit hash
    const remoteHead = exec(`git rev-parse origin/${currentBranch}`, {
      silent: true,
    }).trim();

    // 如果 local 和 remote 不同，且 local 不是 remote 的直接後代（非 fast-forward），則需要 force
    if (localHead !== remoteHead) {
      try {
        // 檢查 remote HEAD 是否是 local HEAD 的祖先（fast-forward 情況）
        exec(`git merge-base --is-ancestor origin/${currentBranch} HEAD`, {
          silent: true,
        });
        // 如果上面的命令成功，說明是 fast-forward，不需要 force
        needsForceWithLease = false;
      } catch (e) {
        // 如果上面的命令失敗，說明不是 fast-forward（可能是 rebase 後），需要 force
        needsForceWithLease = true;
      }
    }
  } catch (error) {
    // 如果無法檢查，預設不使用 force
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

    // 自動推送到遠端（rebase 後使用 --force-with-lease）
    const pushResult = pushToRemote(currentBranch, needsForceWithLease);
    if (!pushResult.success) {
      console.error("\n❌ 推送失敗，無法建立 MR\n");
      console.error(`   錯誤: ${pushResult.error}\n`);
      process.exit(1);
    }

    console.log("✅ 所有 commits 已成功推送到遠端\n");
  }

  // 檢查用戶是否明確指定了 reviewer
  const reviewerArg = args.find((arg) => arg.startsWith("--reviewer="));
  const userExplicitlySetReviewer = !!reviewerArg; // 用戶是否明確指定了 reviewer

  // Reviewer 優先順序：指令內指定 > 用戶設置偏好（.env.local） > 預設值 (william)
  let reviewer;
  if (reviewerArg) {
    // 優先級 1: 指令內指定
    reviewer = reviewerArg.split("=")[1];
  } else {
    // 優先級 2: 從 .env.local 讀取用戶偏好
    const envLocal = loadEnvLocal();
    reviewer = process.env.MR_REVIEWER || envLocal.MR_REVIEWER;

    // 優先級 3: 預設值
    if (!reviewer) {
      reviewer = "@william.chiang";
    }
  }

  const skipReview = args.includes("--no-review");

  const relatedTicketsArg = args
    .find((arg) => arg.startsWith("--related-tickets="))
    ?.split("=")[1];
  const commitMessageFull = getLastCommitMessage();
  const commitMessage = getLastCommitSubject(); // 只使用 subject 作為標題
  let ticket = currentBranch.match(/FE-\d+|IN-\d+/)?.[0] || "N/A";

  // 只有 feature branch（fix/、feat/、feature/ 開頭）才需要檢查單號是否存在
  if (ticket !== "N/A" && isFeatureBranch(currentBranch)) {
    console.log(`🔍 正在檢查單號 ${ticket} 是否存在...\n`);
    const ticketCheck = await checkJiraTicketExists(ticket);

    if (ticketCheck.error) {
      // 如果有錯誤（如配置缺失），跳過檢查並繼續
      console.log(`⚠️  無法檢查單號是否存在: ${ticketCheck.error}\n`);
      console.log(`   將繼續使用分支中的單號 ${ticket}\n`);
    } else if (!ticketCheck.exists) {
      // 單號不存在，請用戶提供正確的單號
      const correctTicket = await getCorrectTicketFromUser(ticket);

      // 驗證新單號是否存在
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

      // 使用新單號重命名分支
      const oldBranch = currentBranch;
      // 將分支名稱中的舊單號替換為新單號
      const newBranch = oldBranch.replace(ticket, correctTicket);

      if (oldBranch === newBranch) {
        console.log(`⚠️  分支名稱中未找到單號，無法自動重命名\n`);
        console.log(`   請手動重命名分支後重新執行命令\n`);
        process.exit(1);
      }

      try {
        await renameBranch(oldBranch, newBranch);
        // 更新變數
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

  // 獲取當前用戶 ID 作為 assignee
  console.log("👤 正在獲取當前用戶信息...\n");
  const assigneeId = await getGitLabUserId();
  let assignee = null;
  if (assigneeId) {
    // 對於 glab，使用當前用戶的 username（從 glab api user 獲取）
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
        // 如果無法獲取 username，使用 ID
        assignee = assigneeId.toString();
      }
    } else {
      assignee = assigneeId.toString();
    }
    console.log(`✅ 已設置 assignee: ${assignee}\n`);
  } else {
    console.log("⚠️  無法獲取當前用戶信息，將不設置 assignee\n");
  }

  // 獲取 Jira ticket title 作為 MR title
  // 如果關聯多張單，以 feature branch 名稱的單為主
  let mrTitle = commitMessage; // 預設使用 commit message
  if (ticket !== "N/A") {
    console.log(`📋 正在獲取 Jira ticket ${ticket} 的 title...\n`);
    const jiraTitle = await getJiraTicketTitle(ticket);
    if (jiraTitle) {
      // 從 commit message 提取 type（格式：type(ticket): message）
      const commitMatch = commitMessage.match(/^(\w+)\([^)]+\):\s*(.+)$/);
      if (commitMatch) {
        const type = commitMatch[1];
        mrTitle = `${type}(${ticket}): ${jiraTitle}`;
      } else {
        // 如果無法解析 commit message，使用 ticket 和 title
        mrTitle = `${ticket}: ${jiraTitle}`;
      }
      console.log(`✅ 已使用 Jira ticket title: ${mrTitle}\n`);
    } else {
      console.log(
        `⚠️  無法獲取 Jira ticket ${ticket} 的 title，將使用 commit message 作為 MR title\n`
      );
    }
  }

  // 處理關聯單號和描述
  let description = "";
  if (relatedTicketsArg) {
    // 解析關聯單號（支持逗號或空格分隔）
    const relatedTickets = relatedTicketsArg
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    // 合併當前分支單號和關聯單號，格式：單號1 , 單號2 , 單號3
    const allTickets = [ticket, ...relatedTickets].filter((t) => t !== "N/A");
    description = allTickets.join(" , ");
  } else {
    description = ticket;
  }

  // 如果 commit message 有 body，將其添加到 description
  const commitLines = commitMessageFull.split("\n");
  if (commitLines.length > 1) {
    const commitBody = commitLines.slice(1).join("\n").trim();
    if (commitBody) {
      description = description
        ? `${description}\n\n${commitBody}`
        : commitBody;
    }
  }

  // 檢查是否由 start-task 啟動，如果是則添加開發計劃到 description
  const startTaskInfo = readStartTaskInfo();
  if (
    startTaskInfo &&
    startTaskInfo.suggestedSteps &&
    startTaskInfo.suggestedSteps.length > 0
  ) {
    console.log(
      "📋 檢測到由 start-task 啟動，將添加開發計劃到 MR description\n"
    );

    const planSection = [
      "## 🎯 開發計劃",
      "",
      "本 MR 由 `start-task` 命令啟動，以下是初步制定的開發計劃：",
      "",
      ...startTaskInfo.suggestedSteps.map((step) => `- ${step}`),
      "",
      `**Jira Ticket:** ${startTaskInfo.ticket}`,
      `**標題:** ${startTaskInfo.summary}`,
      `**類型:** ${startTaskInfo.issueType}`,
      `**狀態:** ${startTaskInfo.status}`,
      `**負責人:** ${startTaskInfo.assignee}`,
      `**優先級:** ${startTaskInfo.priority}`,
      `**啟動時間:** ${new Date(startTaskInfo.startedAt).toLocaleString(
        "zh-TW"
      )}`,
    ].join("\n");

    description = description
      ? `${description}\n\n${planSection}`
      : planSection;
  }

  // 分析改動檔案的影響範圍
  console.log("🔍 分析改動檔案的影響範圍...\n");
  const changedFiles = getChangedFiles(targetBranch);
  let labels = [];
  let impact = { v3: false, v4: false };

  if (changedFiles.length > 0) {
    console.log(`📁 發現 ${changedFiles.length} 個改動檔案`);
    impact = analyzeImpactScope(changedFiles);
    const labelResult = await determineLabels(impact, ticket, changedFiles);
    labels = labelResult.labels;

    // 如果檢測到 Hotfix，自動設置 target branch 為對應的 release branch
    if (labelResult.releaseBranch) {
      const originalTargetBranch = targetBranch;
      targetBranch = labelResult.releaseBranch;
      console.log(
        `   → 檢測到 Hotfix，自動設置 target branch: ${originalTargetBranch} → ${targetBranch}\n`
      );
    }

    if (labels.length > 0) {
      console.log(`🏷️  將添加 labels: ${labels.join(", ")}\n`);
    } else {
      console.log("ℹ️  未檢測到需要添加的 labels\n");
    }
  } else {
    console.log("ℹ️  未發現改動的檔案，跳過影響範圍分析\n");
    // 即使沒有改動檔案，也根據 ticket 添加 FE Board label 和版本 label
    if (ticket && ticket.startsWith("FE-")) {
      labels.push("FE Board");
    }
    // 獲取 Jira ticket 的 fix version 並添加版本 label
    if (ticket && ticket !== "N/A") {
      try {
        const fixVersion = await getJiraFixVersion(ticket);
        if (fixVersion) {
          console.log(`📋 Jira ticket ${ticket} 的 fix version: ${fixVersion}`);
          const versionLabel = extractVersionLabel(fixVersion);
          if (versionLabel) {
            console.log(`   → 提取版本 label: ${versionLabel}`);
            labels.push(versionLabel);
          }
          // 如果 fix version 最後數字非 0，添加 Hotfix label
          if (isHotfixVersion(fixVersion)) {
            console.log(`   → 檢測到 Hotfix 版本，將添加 Hotfix label`);
            labels.push("Hotfix");
            // 自動設置 target branch 為對應的 release branch
            const releaseBranch = extractReleaseBranch(fixVersion);
            if (releaseBranch) {
              const originalTargetBranch = targetBranch;
              targetBranch = releaseBranch;
              console.log(
                `   → 檢測到 Hotfix，自動設置 target branch: ${originalTargetBranch} → ${targetBranch}\n`
              );
            }
          }
          console.log("");
        }
      } catch (error) {
        // Token 過期錯誤已在 getJiraFixVersion 中處理並顯示提示
        // 這裡只記錄錯誤，不中斷流程
        if (error.message && error.message.includes("Jira API Token")) {
          // Token 過期，不添加版本 label，但繼續執行其他邏輯
        }
      }
    }
    if (labels.length > 0) {
      console.log(`🏷️  將添加 labels: ${labels.join(", ")}\n`);
    }
  }

  // 檢查是否需要確認 Hotfix 的 target branch
  // 只有在用戶明確指定了不同的 target branch 時才提示確認
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

  // 先檢查是否有現有 MR
  let existingMR = null;
  let existingMRId = null;
  let existingMRDetails = null; // 現有 MR 的完整信息（包括 reviewer）
  let shouldUpdateReviewer = true; // 是否應該更新 reviewer

  // 優先使用 glab CLI（使用用戶自己的認證）
  if (hasGlab()) {
    const hostname = "gitlab.service-hub.tech";

    // 檢查是否已登入
    if (isGlabAuthenticated(hostname)) {
      existingMRId = findExistingMRWithGlab(currentBranch);
      if (existingMRId) {
        console.log(`\n🔍 發現現有 MR: !${existingMRId}\n`);
        existingMR = { iid: existingMRId };
        // 獲取現有 MR 的完整信息
        existingMRDetails = getMRDetailsWithGlab(existingMRId);
      }
    }
  }

  // 如果 glab 沒找到，或找到但無法獲取詳情，嘗試使用 API
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
      // 如果找到了 MR 但還沒有詳情，嘗試用 API 獲取詳情
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

  // CRITICAL: 如果現有 MR 已經有 reviewer，且用戶沒有明確指定 reviewer，則不更新 reviewer
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

  // 優先使用 glab CLI（使用用戶自己的認證）
  if (hasGlab()) {
    const hostname = "gitlab.service-hub.tech";

    // 檢查 SSH 是否已配置
    const sshConfigured = isSSHConfigured(hostname);
    if (sshConfigured) {
      console.log("✅ 檢測到 SSH 已配置，將使用 SSH 進行 Git 操作\n");
    }

    // 檢查是否已登入
    if (!isGlabAuthenticated(hostname)) {
      console.log("🔐 檢測到 glab 尚未登入，需要進行認證...\n");

      // 如果 SSH 已配置，提示用戶只需要 token（用於 API 調用）
      if (sshConfigured) {
        console.log(
          "💡 你的 SSH 已配置，只需要 Personal Access Token 進行 API 調用"
        );
        console.log("   Git 操作將自動使用 SSH 協議\n");
      }

      // 嘗試從環境變數或 git config 獲取 token
      let token = getGitLabToken();

      if (!token) {
        // 如果沒有 token，顯示詳細教學並提示用戶輸入
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
          // 如果 SSH 已配置，使用 SSH 協議；否則使用 HTTPS
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

    // 嘗試使用 glab 建立或更新 MR
    if (isGlabAuthenticated(hostname)) {
      if (existingMR) {
        console.log("✅ 使用 GitLab CLI (glab) 更新 MR...\n");
        try {
          // CRITICAL: 已存在的 MR title 不可異動，不傳入 title
          // CRITICAL: 如果現有 MR 已有 reviewer 且用戶未明確指定，則不更新 reviewer
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

          // 提取 MR URL 和 ID
          const mrUrlMatch = result.match(
            /https:\/\/[^\s]+merge_requests\/(\d+)/
          );
          if (mrUrlMatch) {
            const mrUrl = mrUrlMatch[0];
            const mrId = mrUrlMatch[1];
            console.log(`🔗 MR 連結: [MR !${mrId}](${mrUrl})`);
            console.log(`📊 MR ID: !${mrId}`);

            // 顯示關聯 Jira card 的短連結
            const jiraTickets = extractJiraTickets(description);
            if (jiraTickets.length > 0) {
              const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
              console.log(`🎫 關聯 Jira: ${jiraLinks}`);
            }
            console.log("");

            // 提交 AI review（如果未設置 --no-review）
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
            // 如果無法提取 URL，直接輸出原始結果
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

          // 提取 MR URL 和 ID
          const mrUrlMatch = result.match(
            /https:\/\/[^\s]+merge_requests\/(\d+)/
          );
          if (mrUrlMatch) {
            const mrUrl = mrUrlMatch[0];
            const mrId = mrUrlMatch[1];
            console.log(`🔗 MR 連結: [MR !${mrId}](${mrUrl})`);
            console.log(`📊 MR ID: !${mrId}`);

            // 顯示關聯 Jira card 的短連結
            const jiraTickets = extractJiraTickets(description);
            if (jiraTickets.length > 0) {
              const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
              console.log(`🎫 關聯 Jira: ${jiraLinks}`);
            }
            console.log("");

            // 提交 AI review（如果未設置 --no-review）
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
            // 如果無法提取 URL，直接輸出原始結果
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

  // 如果 glab 不可用，使用 API token
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

  // 查找 reviewer 的 user ID
  let reviewerId = null;
  if (reviewer) {
    // 檢查是否已經是數字 ID
    if (/^\d+$/.test(reviewer)) {
      reviewerId = parseInt(reviewer, 10);
      console.log(`✅ 使用用戶 ID: ${reviewerId}\n`);
    } else {
      // 嘗試通過用戶名查找
      console.log(`🔍 查找用戶: ${reviewer}...`);
      reviewerId = await findUserId(token, projectInfo.host, reviewer);
      if (reviewerId) {
        console.log(`✅ 找到用戶 ID: ${reviewerId}\n`);
      } else {
        // 如果找不到用戶，輸出錯誤訊息並退出，讓 AI 在 chat 中詢問用戶
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
      // CRITICAL: 已存在的 MR title 不可異動，不傳入 title
      // CRITICAL: 如果現有 MR 已有 reviewer 且用戶未明確指定，則不更新 reviewer
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
      // 顯示關聯 Jira card 的短連結
      const jiraTickets = extractJiraTickets(description);
      if (jiraTickets.length > 0) {
        const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
        console.log(`🎫 關聯 Jira: ${jiraLinks}`);
      }
      console.log("");

      // 提交 AI review（如果未設置 --no-review）
      if (!skipReview) {
        console.log("🤖 正在提交 AI review...");
        try {
          await submitAIReview(mr.web_url);
          console.log("✅ AI review 已提交\n");
        } catch (error) {
          console.error(`⚠️  AI review 提交失敗: ${error.message}\n`);
          // 不中斷流程，只顯示警告
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
      // 顯示關聯 Jira card 的短連結
      const jiraTickets = extractJiraTickets(description);
      if (jiraTickets.length > 0) {
        const jiraLinks = formatJiraTicketsAsLinks(jiraTickets);
        console.log(`🎫 關聯 Jira: ${jiraLinks}`);
      }
      console.log("");

      // 提交 AI review（如果未設置 --no-review）
      if (!skipReview) {
        console.log("🤖 正在提交 AI review...");
        try {
          await submitAIReview(mr.web_url);
          console.log("✅ AI review 已提交\n");
        } catch (error) {
          console.error(`⚠️  AI review 提交失敗: ${error.message}\n`);
          // 不中斷流程，只顯示警告
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

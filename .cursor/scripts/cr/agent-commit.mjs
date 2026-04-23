#!/usr/bin/env node

/**
 * Agent 專用的自動 Commit 腳本
 * 這個腳本接受參數，讓 Cursor agent 可以直接調用
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "../utilities/env-loader.mjs";

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

function hasPackageScript(scriptName) {
  try {
    const packageJsonPath = join(projectRoot, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return Boolean(packageJson.scripts?.[scriptName]);
  } catch (error) {
    return false;
  }
}

// 從命令行參數獲取信息
const args = process.argv.slice(2);
const type = args.find((arg) => arg.startsWith("--type="))?.split("=")[1];
const ticket = args.find((arg) => arg.startsWith("--ticket="))?.split("=")[1];
const message = args.find((arg) => arg.startsWith("--message="))?.split("=")[1];
const skipLint = args.includes("--skip-lint");
const autoPush = args.includes("--auto-push");

// 驗證參數
if (!type || !ticket || !message) {
  console.error("缺少必要參數: --type, --ticket, --message");
  process.exit(1);
}

// 驗證 ticket 格式
if (!/^[A-Z0-9]+\-[0-9]+$/.test(ticket)) {
  console.error(`無效的 ticket 格式: ${ticket}`);
  process.exit(1);
}

// 驗證 message
if (message.length > 64) {
  console.error(`Message 超過 64 字元: ${message.length}`);
  process.exit(1);
}

if (message !== message.toLowerCase()) {
  console.error("Message 必須是小寫");
  process.exit(1);
}

// 檢查是否包含中文字符
if (/[\u4e00-\u9fff]/.test(message)) {
  console.error("❌ Commit message 不允許使用中文，請使用英文");
  console.error(`   檢測到的 message: ${message}`);
  process.exit(1);
}

// 構建 commit message
const commitMessage = `${type}(${ticket}): ${message}`;

console.log(`\n📝 Commit message: ${commitMessage}\n`);

// 運行 lint（如果未跳過）
if (!skipLint) {
  if (!hasPackageScript("format-and-lint")) {
    console.log(
      "⚠️  查無 format-and-lint script，略過 lint 檢查並繼續流程\n"
    );
  } else {
    console.log("🔍 運行 lint 檢查...");
    try {
      exec("pnpm run format-and-lint");
      console.log("✅ Lint 檢查通過\n");
    } catch (error) {
      console.error("❌ Lint 檢查失敗");
      process.exit(1);
    }
  }
}

// 添加檔案
console.log("📦 添加檔案到暫存區...");
exec("git add .");
console.log("✅ 檔案已添加\n");

// 創建 commit
console.log("💾 創建 commit...");
try {
  exec(`git commit -m "${commitMessage}"`);
  console.log("✅ Commit 創建成功\n");
} catch (error) {
  console.error("❌ Commit 創建失敗");
  process.exit(1);
}

// 檢查並複製 start-task Git notes 到新 commit
try {
  const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();

  // 嘗試從父 commit 讀取 Git notes
  try {
    const parentCommit = exec("git rev-parse HEAD^", { silent: true }).trim();
    const parentNote = exec(`git notes --ref=start-task show ${parentCommit}`, {
      silent: true,
    }).trim();
    if (parentNote) {
      // 複製到當前 commit
      const result = spawnSync(
        "git",
        ["notes", "--ref=start-task", "add", "-f", "-F", "-", currentCommit],
        {
          cwd: projectRoot,
          input: parentNote,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      if (result.status === 0) {
        console.log("✅ 已複製 start-task Git notes 到新 commit\n");
      }
    }
  } catch (parentError) {
    // 父 commit 沒有 Git notes，嘗試從分支的 base commit 讀取
    try {
      const baseCommit = exec("git merge-base HEAD main", {
        silent: true,
      }).trim();
      const baseNote = exec(`git notes --ref=start-task show ${baseCommit}`, {
        silent: true,
      }).trim();
      if (baseNote) {
        const result = spawnSync(
          "git",
          ["notes", "--ref=start-task", "add", "-f", "-F", "-", currentCommit],
          {
            cwd: projectRoot,
            input: baseNote,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }
        );

        if (result.status === 0) {
          console.log(
            "✅ 已從 base commit 複製 start-task Git notes 到新 commit\n"
          );
        }
      }
    } catch (baseError) {
      // 沒有找到 Git notes，繼續執行（這不是錯誤）
    }
  }
} catch (error) {
  // 忽略錯誤，繼續執行（Git notes 複製失敗不應該中斷流程）
}

// 獲取當前分支
const currentBranch = exec("git rev-parse --abbrev-ref HEAD", {
  silent: true,
}).trim();

// 推送到遠端（如果啟用）
if (autoPush) {
  console.log("🚀 推送到遠端...");
  try {
    // 先檢查遠端分支是否存在
    let remoteBranchExists = false;
    try {
      exec(`git ls-remote --heads origin ${currentBranch}`, { silent: true });
      remoteBranchExists = true;
    } catch (error) {
      // 遠端分支不存在，這是正常的（新分支）
      remoteBranchExists = false;
    }

    // 如果遠端分支不存在，使用 -u 設置 upstream；否則直接推送
    if (!remoteBranchExists) {
      console.log(`📤 遠端分支不存在，使用 -u 設置 upstream...`);
      exec(`git push -u origin ${currentBranch}`);
    } else {
      exec(`git push origin ${currentBranch}`);
    }
    console.log("✅ 推送成功\n");

    // 獲取 remote URL
    try {
      const remoteUrl = exec("git config --get remote.origin.url", {
        silent: true,
      }).trim();
      if (remoteUrl.startsWith("git@")) {
        const match = remoteUrl.match(/git@([^:]+):(.+)/);
        if (match) {
          const [, host, path] = match;
          const mrUrl = `https://${host}/${path.replace(
            /\.git$/,
            ""
          )}/-/merge_requests/new?merge_request[source_branch]=${currentBranch}`;
          // 使用 Markdown 超連結格式，符合 mr-execution-result-report.mdc 規範
          console.log(`🔗 MR 連結: [建立 MR](${mrUrl})\n`);
        }
      }
    } catch (error) {
      // 忽略 remote URL 獲取錯誤
    }
  } catch (error) {
    console.error("❌ 推送失敗");
    console.error(`錯誤: ${error.message}`);
    console.log(`\n💡 請檢查：`);
    console.log(`   1. 網路連線是否正常`);
    console.log(`   2. Git 認證是否正確`);
    console.log(`   3. 遠端倉庫權限是否足夠`);
    console.log(
      `\n   如果分支不存在，請使用: git push -u origin ${currentBranch}`
    );
    process.exit(1);
  }
} else {
  console.log(`\n💡 使用以下指令推送到遠端:`);
  console.log(`   git push origin ${currentBranch}\n`);
}

console.log("✅ 完成！");

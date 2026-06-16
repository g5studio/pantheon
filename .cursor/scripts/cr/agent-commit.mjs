#!/usr/bin/env node
/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/cr/agent-commit.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8065
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 宣告內容需依 input.declarationOrigins 指定的 origin tickets 標註用途；無 tickets 則省略 @external。
 * @purpose 修正宣告註解的外部來源標示規則與三段式區塊格式一致性
 */
/**
 * === 檔案用途區塊 ===
 * @module agent-commit
 * @purpose 自動化 Cursor agent 呼叫用的 Git commit 流程（參數驗證、lint、git add、建立 commit、複製 start-task notes、可選推送）。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "../utilities/env-loader.mjs";
import {
  logProgress,
  resolveOutputFormat,
  writeScriptError,
  writeScriptResult,
} from "../utilities/external-output.mjs";

// 使用 env-loader 提供的 projectRoot
/**
 * 宣告內容用途說明與單號關聯
 * @description 取得專案根目錄，供後續執行 git 與讀取 package.json 使用。
 * @purpose 讓腳本在不同工作目錄下仍可穩定定位專案路徑。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
const projectRoot = getProjectRoot();

/**
 * 宣告內容用途說明與單號關聯
 * @description 以同步方式執行 shell 指令，並支援靜默/顯示輸出。
 * @purpose 用於整合 git 與 npm/pnpm 指令流程。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
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

/**
 * 宣告內容用途說明與單號關聯
 * @description 檢查 package.json 中是否存在指定的 script。
 * @purpose 在決定是否執行 format-and-lint 之前做能力探測。
 * @external https://innotech.atlassian.net/browse/FE-8065
 */
function hasPackageScript(scriptName) {
  try {
    /**
     * 宣告內容用途說明與單號關聯
     * @description 組合 package.json 的絕對路徑，供讀取與解析使用。
     * @purpose 支援在 projectRoot 下定位檔案。
     * @external https://innotech.atlassian.net/browse/FE-8065
     */
    const packageJsonPath = join(projectRoot, "package.json");

    /**
     * 宣告內容用途說明與單號關聯
     * @description 讀取並解析 package.json，用來判斷 scripts 是否包含指定項目。
     * @purpose 解析 package scripts 清單。
     * @external https://innotech.atlassian.net/browse/FE-8065
     */
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    return Boolean(packageJson.scripts?.[scriptName]);
  } catch (error) {
    return false;
  }
}

// 從命令行參數獲取信息
/**
 * 宣告內容用途說明與單號關聯
 * @description 取得命令行參數陣列（不含 node 與 script 路徑）。
 * @purpose 供後續解析 --type/--ticket/--message 與開關參數。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const args = process.argv.slice(2);
/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 --type=xx 參數，用於組合 commit 類型前綴。
 * @purpose 決定 commitMessage 的第一段。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const type = args.find((arg) => arg.startsWith("--type="))?.split("=")[1];
/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 --ticket=FE-1234 參數，用於 commitMessage 中的 Jira ticket。
 * @purpose 用於提交訊息格式中的括號標示。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const ticket = args.find((arg) => arg.startsWith("--ticket="))?.split("=")[1];
/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 --message=... 參數，用於 commit 訊息正文。
 * @purpose 形成最終 commit message。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const message = args.find((arg) => arg.startsWith("--message="))?.split("=")[1];
/**
 * 宣告內容用途說明與單號關聯
 * @description 判斷是否包含 --skip-lint 開關。
 * @purpose 決定是否執行 lint 檢查流程。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const skipLint = args.includes("--skip-lint");
/**
 * 宣告內容用途說明與單號關聯
 * @description 判斷是否包含 --auto-push 開關。
 * @purpose 決定是否在 commit 後自動推送到遠端。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const autoPush = args.includes("--auto-push");
const formatArg = args.find((arg) => arg.startsWith("--format="))?.split("=")[1];
const outputFormat = resolveOutputFormat(formatArg);

// 驗證參數
if (!type || !ticket || !message) {
  writeScriptError("缺少必要參數: --type, --ticket, --message", "MISSING_ARGS");
}

// 驗證 ticket 格式
if (!/^[A-Z0-9]+\-[0-9]+$/.test(ticket)) {
  writeScriptError(`無效的 ticket 格式: ${ticket}`, "INVALID_TICKET");
}

// 驗證 message
if (message.length > 64) {
  writeScriptError(`Message 超過 64 字元: ${message.length}`, "MESSAGE_TOO_LONG");
}

if (message !== message.toLowerCase()) {
  writeScriptError("Message 必須是小寫", "MESSAGE_NOT_LOWERCASE");
}

// 檢查是否包含中文字符
if (/[\u4e00-\u9fff]/.test(message)) {
  writeScriptError(
    `Commit message 不允許使用中文，請使用英文。檢測到的 message: ${message}`,
    "MESSAGE_CONTAINS_CHINESE",
  );
}

// 構建 commit message
const commitMessage = `${type}(${ticket}): ${message}`;

logProgress(`\n📝 Commit message: ${commitMessage}\n`);

// 運行 lint（如果未跳過）
if (!skipLint) {
  if (!hasPackageScript("format-and-lint")) {
    logProgress(
      "⚠️  查無 format-and-lint script，略過 lint 檢查並繼續流程\n"
    );
  } else {
    logProgress("🔍 運行 lint 檢查...");
    try {
      exec("pnpm run format-and-lint");
      logProgress("✅ Lint 檢查通過\n");
    } catch (error) {
      writeScriptError("Lint 檢查失敗", "LINT_FAILED");
    }
  }
}

// 添加檔案
logProgress("📦 添加檔案到暫存區...");
exec("git add .");
logProgress("✅ 檔案已添加\n");

// 創建 commit
logProgress("💾 創建 commit...");
try {
  exec(`git commit -m "${commitMessage}"`);
  logProgress("✅ Commit 創建成功\n");
} catch (error) {
  writeScriptError("Commit 創建失敗", "COMMIT_FAILED");
}

// 檢查並複製 start-task Git notes 到新 commit
try {
  /**
     * 宣告內容用途說明與單號關聯
     * @description 取得當前新建立 commit 的 SHA。
     * @purpose 作為 git notes 的目標 commit。
     * @external https://innotech.atlassian.net/browse/FE-7893
     */
  const currentCommit = exec("git rev-parse HEAD", { silent: true }).trim();

  // 嘗試從父 commit 讀取 Git notes
  try {
    /**
     * 宣告內容用途說明與單號關聯
     * @description 取得父 commit 的 SHA，用於嘗試從父節點讀取 start-task notes。
     * @purpose 支援將 notes 延續到新 commit。
     * @external https://innotech.atlassian.net/browse/FE-7893
     */
    const parentCommit = exec("git rev-parse HEAD^", { silent: true }).trim();
    const parentNote = exec(`git notes --ref=start-task show ${parentCommit}`, {
      silent: true,
    }).trim();
    if (parentNote) {
      // 複製到當前 commit
      /**
       * 宣告內容用途說明與單號關聯
       * @description 將父 commit 的 start-task Git notes 寫入當前 commit。
       * @purpose 讓同一任務/流程的 notes 在 commit 間保持一致。
       * @external https://innotech.atlassian.net/browse/FE-7893
       */
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
        logProgress("✅ 已複製 start-task Git notes 到新 commit\n");
      }
    }
  } catch (parentError) {
    // 父 commit 沒有 Git notes，嘗試從分支的 base commit 讀取
    try {
      /**
       * 宣告內容用途說明與單號關聯
       * @description 取得以 main 為基準的 merge-base commit SHA，用於在父節點無 notes 時回溯來源。
       * @purpose 讓 notes 可從分支起點延續。
       * @external https://innotech.atlassian.net/browse/FE-7893
       */
      const baseCommit = exec("git merge-base HEAD main", {
        silent: true,
      }).trim();
      const baseNote = exec(`git notes --ref=start-task show ${baseCommit}`, {
        silent: true,
      }).trim();
      if (baseNote) {
        /**
         * 宣告內容用途說明與單號關聯
         * @description 將 base commit 的 start-task Git notes 寫入當前 commit。
         * @purpose 在回溯路徑下保留 notes 延續。
         * @external https://innotech.atlassian.net/browse/FE-7893
         */
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
          logProgress(
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
/**
 * 宣告內容用途說明與單號關聯
 * @description 取得目前所在分支名稱。
 * @purpose 用於決定後續推送目標分支。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
const currentBranch = exec("git rev-parse --abbrev-ref HEAD", {
  silent: true,
}).trim();
const commitHash = exec("git rev-parse HEAD", { silent: true }).trim();
let mrCreateUrl = null;
let pushed = false;

// 推送到遠端（如果啟用）
if (autoPush) {
  logProgress("🚀 推送到遠端...");
  try {
    // 先檢查遠端分支是否存在
    /**
     * 宣告內容用途說明與單號關聯
     * @description 記錄遠端分支是否已存在，用於決定 push 是否需要 -u upstream 設定。
     * @purpose 支援新分支首次推送流程。
     * @external https://innotech.atlassian.net/browse/FE-7893
     */
    let remoteBranchExists = false;
    try {
      /**
       * 宣告內容用途說明與單號關聯
       * @description 查詢 origin 上是否存在指定分支，用作存在性判斷。
       * @purpose 影響後續 git push 指令參數。
       * @external https://innotech.atlassian.net/browse/FE-7893
       */
      exec(`git ls-remote --heads origin ${currentBranch}`, { silent: true });
      remoteBranchExists = true;
    } catch (error) {
      // 遠端分支不存在，這是正常的（新分支）
      remoteBranchExists = false;
    }

    // 如果遠端分支不存在，使用 -u 設置 upstream；否則直接推送
    if (!remoteBranchExists) {
      logProgress(`📤 遠端分支不存在，使用 -u 設置 upstream...`);
      exec(`git push -u origin ${currentBranch}`);
    } else {
      exec(`git push origin ${currentBranch}`);
    }
    logProgress("✅ 推送成功\n");
    pushed = true;

    // 獲取 remote URL
    try {
      /**
       * 宣告內容用途說明與單號關聯
       * @description 取得遠端倉庫的 origin URL，供組裝 MR 連結。
       * @purpose 用於輸出可點擊的 Merge Request 新建連結。
       * @external https://innotech.atlassian.net/browse/FE-7893
       */
      const remoteUrl = exec("git config --get remote.origin.url", {
        silent: true,
      }).trim();
      if (remoteUrl.startsWith("git@")) {
        /**
         * 宣告內容用途說明與單號關聯
         * @description 解析 git@host:path 格式的 remote URL，拆出主機與路徑。
         * @purpose 建立對應的 https MR 網址。
         * @external https://innotech.atlassian.net/browse/FE-7893
         */
        const match = remoteUrl.match(/git@([^:]+):(.+)/);
        if (match) {
          /**
           * 宣告內容用途說明與單號關聯
           * @description 將匹配結果拆解為 host 與 path，供 URL 組裝使用。
           * @purpose 作為 mrUrl 的組成元素。
           * @external https://innotech.atlassian.net/browse/FE-7893
           */
          const [, host, path] = match;
          mrCreateUrl = `https://${host}/${path.replace(
            /\.git$/,
            ""
          )}/-/merge_requests/new?merge_request[source_branch]=${currentBranch}`;
          logProgress(`🔗 MR 連結: [建立 MR](${mrCreateUrl})\n`);
        }
      }
    } catch (error) {
      // 忽略 remote URL 獲取錯誤
    }
  } catch (error) {
    writeScriptError(
      `推送失敗: ${error.message}。若分支不存在，請使用: git push -u origin ${currentBranch}`,
      "PUSH_FAILED",
    );
  }
} else {
  logProgress(`\n💡 使用以下指令推送到遠端:`);
  logProgress(`   git push origin ${currentBranch}\n`);
}

writeScriptResult(
  {
    source: "git",
    action: "commit",
    commit: {
      hash: commitHash,
      shortHash: commitHash.slice(0, 7),
      message: commitMessage,
      type,
      ticket,
    },
    branch: currentBranch,
    pushed,
    mrCreateUrl,
    lintSkipped: skipLint,
    message: `Commit ${commitHash.slice(0, 7)} created on ${currentBranch}`,
  },
  outputFormat,
);

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-14T19:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note FE-8389：progress 改 stderr；成功結果 stdout compact JSON；錯誤走 writeScriptError。
 */

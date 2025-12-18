#!/usr/bin/env node

/**
 * Oracle - Pantheon Cursor 同步腳本
 *
 * 將 .pantheon/.cursor 的內容透過符號連結同步到專案的 .cursor 目錄中
 *
 * 使用方式:
 *   node .cursor/scripts/utilities/oracle.mjs
 *   node .pantheon/.cursor/scripts/utilities/oracle.mjs
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  copyFileSync,
  readdirSync,
} from "fs";
import { execSync } from "child_process";
import { join } from "path";

// 顏色輸出
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}🔄 ${msg}${colors.reset}`),
  dim: (msg) => console.log(`${colors.dim}   ${msg}${colors.reset}`),
};

/**
 * 執行 shell 命令
 */
function exec(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: "pipe",
      ...options,
    }).trim();
  } catch (error) {
    if (options.throwOnError !== false) {
      throw error;
    }
    return null;
  }
}

/**
 * 檢查路徑是否為符號連結
 */
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 主程式
 */
async function main() {
  console.log("");
  console.log("🔮 Oracle - Pantheon Cursor 同步");
  console.log("=================================");
  console.log("");

  // 確定工作目錄（專案根目錄）
  const cwd = process.cwd();

  // ========================================
  // 1. 檢查 .pantheon 是否存在
  // ========================================
  const pantheonCursorPath = join(cwd, ".pantheon", ".cursor");

  if (!existsSync(pantheonCursorPath)) {
    log.error("找不到 .pantheon 資料夾");
    console.log("");
    console.log("請先執行: npm run pantheon:descend");
    process.exit(1);
  }
  log.success(".pantheon 存在");

  // ========================================
  // 2. 拉取 pantheon 當前分支最新內容
  // ========================================
  console.log("");
  log.info("正在拉取 pantheon 最新內容...");

  const pantheonDir = join(cwd, ".pantheon");
  let deityName = "prometheus"; // 預設值

  try {
    const currentBranch = exec("git rev-parse --abbrev-ref HEAD", {
      cwd: pantheonDir,
    });
    // 使用分支名稱作為 deity 資料夾名稱
    deityName = currentBranch;
    log.dim(`pantheon 當前分支: ${currentBranch}`);

    // 檢查 pantheon 是否有本地變更
    const localChanges = exec("git status --porcelain", {
      cwd: pantheonDir,
      throwOnError: false,
    });

    if (localChanges && localChanges.trim()) {
      log.warning(".pantheon 有本地變更，將自動重置...");
      log.dim("變更的檔案：");
      localChanges
        .trim()
        .split("\n")
        .forEach((line) => log.dim(`  ${line}`));

      // 重置本地變更
      exec("git checkout -- .", { cwd: pantheonDir });
      // 清除未追蹤的檔案
      exec("git clean -fd", { cwd: pantheonDir, throwOnError: false });

      log.success("本地變更已重置");
    }

    // 執行 fetch 和 pull
    exec("git fetch origin", { cwd: pantheonDir });

    // 檢查是否需要 pull（比較本地與遠端）
    const localCommit = exec("git rev-parse HEAD", { cwd: pantheonDir });
    const remoteCommit = exec(`git rev-parse origin/${currentBranch}`, {
      cwd: pantheonDir,
      throwOnError: false,
    });

    if (remoteCommit && localCommit !== remoteCommit) {
      log.dim(`本地: ${localCommit.substring(0, 8)}`);
      log.dim(`遠端: ${remoteCommit.substring(0, 8)}`);
      exec(`git pull origin ${currentBranch}`, { cwd: pantheonDir });
      log.success("pantheon 已更新至最新");
    } else if (localCommit === remoteCommit) {
      log.success("pantheon 已是最新版本");
    } else {
      log.warning("無法取得遠端 commit，跳過同步");
    }
  } catch (error) {
    log.error(`拉取 pantheon 更新失敗: ${error.message}`);
    log.dim("請手動檢查 .pantheon 目錄狀態");
  }

  // ========================================
  // 3. 建立 .cursor 目錄結構
  // ========================================
  console.log("");
  console.log("📁 建立 .cursor 目錄結構...");

  const directories = [
    join(cwd, ".cursor", "commands"),
    join(cwd, ".cursor", "rules"),
    join(cwd, ".cursor", "scripts"),
  ];

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log.dim(`建立目錄: ${dir.replace(cwd, ".")}`);
    }
  }

  // ========================================
  // 4. 建立 deity 符號連結
  // ========================================
  console.log("");
  console.log(`🔗 建立 ${deityName} 符號連結...`);

  const linkConfigs = [
    {
      link: join(cwd, ".cursor", "commands", deityName),
      target: "../../.pantheon/.cursor/commands",
    },
    {
      link: join(cwd, ".cursor", "rules", deityName),
      target: "../../.pantheon/.cursor/rules",
    },
    {
      link: join(cwd, ".cursor", "scripts", deityName),
      target: "../../.pantheon/.cursor/scripts",
    },
  ];

  for (const config of linkConfigs) {
    // 移除舊的連結（如果存在）
    if (existsSync(config.link) || isSymlink(config.link)) {
      try {
        unlinkSync(config.link);
      } catch {
        // 忽略錯誤
      }
    }

    // 建立新的符號連結
    try {
      symlinkSync(config.target, config.link);
      log.dim(`${config.link.replace(cwd, ".")} -> ${config.target}`);
    } catch (error) {
      log.error(`建立符號連結失敗: ${config.link.replace(cwd, ".")}`);
      log.dim(error.message);
    }
  }

  // ========================================
  // 5. 檢查並建立環境變數配置檔
  // ========================================
  console.log("");
  const envLocalPath = join(cwd, ".cursor", ".env.local");
  const envExamplePath = join(cwd, ".pantheon", ".cursor", ".env.example");
  let envCreated = false;

  if (!existsSync(envLocalPath)) {
    if (existsSync(envExamplePath)) {
      console.log("📝 建立環境變數配置檔...");
      copyFileSync(envExamplePath, envLocalPath);
      envCreated = true;
      log.success("已建立 .cursor/.env.local");
    } else {
      log.warning(".env.example 不存在，跳過建立 .env.local");
    }
  } else {
    log.success(".cursor/.env.local 已存在");
  }

  // ========================================
  // 6. 輸出結果
  // ========================================
  console.log("");
  console.log("==========================================");
  log.success("同步完成！");
  console.log("==========================================");
  console.log("");
  console.log("目錄結構：");
  console.log(".cursor/");
  console.log("├── commands/");
  console.log(`│   └── ${deityName}/ -> .pantheon/.cursor/commands`);
  console.log("├── rules/");
  console.log(`│   └── ${deityName}/ -> .pantheon/.cursor/rules`);
  console.log("├── scripts/");
  console.log(`│   └── ${deityName}/ -> .pantheon/.cursor/scripts`);
  console.log("└── .env.local");
  console.log("");

  // 列出可用的指令
  console.log("可用的指令：");
  const commandsPath = join(cwd, ".cursor", "commands", deityName);
  if (existsSync(commandsPath)) {
    try {
      const dirs = readdirSync(commandsPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => `- commands/${deityName}/${dirent.name}/`);

      if (dirs.length > 0) {
        console.log(dirs.join("\n"));
      } else {
        console.log("(無子目錄)");
      }
    } catch {
      console.log("(無法列出)");
    }
  } else {
    console.log("(無法列出)");
  }

  // 若有新建 .env.local，提示用戶配置
  if (envCreated) {
    console.log("");
    console.log("==========================================");
    log.warning("環境變數配置提醒");
    console.log("==========================================");
    console.log("已建立 .cursor/.env.local，請編輯此檔案填入以下配置：");
    console.log("");
    console.log("必要配置：");
    console.log("  - JIRA_EMAIL: Jira/Confluence 帳號 email");
    console.log("  - JIRA_API_TOKEN: Jira API Token");
    console.log("  - GITLAB_TOKEN: GitLab Personal Access Token");
    console.log("");
    console.log("選填配置：");
    console.log("  - MR_REVIEWER: 預設 MR Reviewer");
    console.log("  - COMPASS_API_TOKEN: Compass API Token");
    console.log("");
  }

  console.log("");
}

// 執行主程式
main().catch((error) => {
  log.error(`執行失敗: ${error.message}`);
  process.exit(1);
});

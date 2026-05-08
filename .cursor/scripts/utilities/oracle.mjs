#!/usr/bin/env node

/**
 * Oracle - Pantheon Cursor 同步腳本
 *
 * 將 .pantheon/.cursor 的內容複製安裝到專案的 .cursor 與 .agent 目錄中
 *
 * 使用方式:
 *   node .cursor/scripts/utilities/oracle.mjs
 *   node .pantheon/.cursor/scripts/utilities/oracle.mjs
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  copyFileSync,
  readdirSync,
  writeFileSync,
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

const GITIGNORE_SECTION_HEADER = "# Pantheon installed tooling";

function removePantheonGitignoreSection(content) {
  const lines = content.split(/\r?\n/);
  const result = [];
  let inPantheonSection = false;
  let removed = false;

  for (const line of lines) {
    if (line.trim() === GITIGNORE_SECTION_HEADER) {
      inPantheonSection = true;
      removed = true;
      continue;
    }

    if (inPantheonSection) {
      if (line.trim() === "") {
        inPantheonSection = false;
      }
      continue;
    }

    result.push(line);
  }

  return {
    content: result.join("\n").replace(/\n{3,}$/g, "\n\n"),
    removed,
  };
}

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
 * 移除舊的同步目標，包含過去版本建立的 symlink。
 */
function removeSyncTarget(path) {
  if (isSymlink(path)) {
    unlinkSync(path);
    return;
  }

  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

/**
 * 將 Pantheon 來源目錄複製到目標專案。
 */
function copyDirectory(source, target, cwd) {
  if (!existsSync(source)) {
    log.warning(`來源不存在，跳過: ${source.replace(cwd, ".")}`);
    return false;
  }

  removeSyncTarget(target);
  mkdirSync(join(target, ".."), { recursive: true });
  cpSync(source, target, { recursive: true });
  log.dim(`${source.replace(cwd, ".")} -> ${target.replace(cwd, ".")}`);
  return true;
}

/**
 * 將 Pantheon 安裝產物加入目標專案 .gitignore。
 */
function updateGitignore(cwd, installFolderName) {
  const gitignorePath = join(cwd, ".gitignore");
  const entries = [
    ".pantheon/",
    `.cursor/commands/${installFolderName}/`,
    `.cursor/rules/${installFolderName}/`,
    `.cursor/scripts/${installFolderName}/`,
    `.cursor/skills/${installFolderName}/`,
    `.agent/commands/${installFolderName}/`,
    `.agent/scripts/${installFolderName}/`,
    `.agent/skills/${installFolderName}/`,
  ];

  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const normalized = removePantheonGitignoreSection(existing);
  const remainingLines = new Set(
    normalized.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const sectionEntries = entries.filter((entry) => !remainingLines.has(entry));

  if (!normalized.removed && sectionEntries.length === 0) {
    log.success(".gitignore 已包含 Pantheon 安裝產物");
    return;
  }

  const baseContent = normalized.content.replace(/\n*$/g, "");
  const prefix = baseContent ? "\n\n" : "";
  const section = [
    GITIGNORE_SECTION_HEADER,
    ...sectionEntries,
    "",
  ].join("\n");

  writeFileSync(gitignorePath, `${baseContent}${prefix}${section}`);
  log.success("已更新 .gitignore");
  sectionEntries.forEach((entry) => log.dim(`保留: ${entry}`));
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
  let installFolderName = "prometheus"; // 預設安裝名稱，會以 .pantheon 當前分支覆蓋

  try {
    const currentBranch = exec("git rev-parse --abbrev-ref HEAD", {
      cwd: pantheonDir,
    });
    installFolderName = currentBranch;
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
    join(cwd, ".cursor", "skills"),
    join(cwd, ".agent", "commands"),
    join(cwd, ".agent", "scripts"),
    join(cwd, ".agent", "skills"),
  ];

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log.dim(`建立目錄: ${dir.replace(cwd, ".")}`);
    }
  }

  // ========================================
  // 4. 複製安裝 Pantheon 內容
  // ========================================
  console.log("");
  console.log(`📦 安裝 ${installFolderName} Pantheon 內容...`);

  const installConfigs = [
    {
      source: join(cwd, ".pantheon", ".cursor", "commands"),
      target: join(cwd, ".cursor", "commands", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "rules"),
      target: join(cwd, ".cursor", "rules", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "scripts"),
      target: join(cwd, ".cursor", "scripts", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "skills"),
      target: join(cwd, ".cursor", "skills", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "commands"),
      target: join(cwd, ".agent", "commands", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "scripts"),
      target: join(cwd, ".agent", "scripts", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "skills"),
      target: join(cwd, ".agent", "skills", installFolderName),
    },
  ];

  for (const config of installConfigs) {
    try {
      copyDirectory(config.source, config.target, cwd);
    } catch (error) {
      log.error(`安裝失敗: ${config.target.replace(cwd, ".")}`);
      log.dim(error.message);
    }
  }

  // ========================================
  // 5. 更新 .gitignore
  // ========================================
  console.log("");
  console.log("🧹 更新 .gitignore...");
  updateGitignore(cwd, installFolderName);

  // ========================================
  // 6. 檢查並建立環境變數配置檔
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
  // 7. 輸出結果
  // ========================================
  console.log("");
  console.log("==========================================");
  log.success("同步完成！");
  console.log("==========================================");
  console.log("");
  console.log("目錄結構：");
  console.log(".cursor/");
  console.log("├── commands/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("├── rules/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("├── scripts/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("├── skills/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("└── .env.local");
  console.log(".agent/");
  console.log("├── commands/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("├── scripts/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("└── skills/");
  console.log(`    └── ${installFolderName}/`);
  console.log("");

  // 列出可用的指令
  console.log("可用的指令：");
  const commandsPath = join(cwd, ".cursor", "commands", installFolderName);
  if (existsSync(commandsPath)) {
    try {
      const dirs = readdirSync(commandsPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => `- commands/${installFolderName}/${dirent.name}/`);

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

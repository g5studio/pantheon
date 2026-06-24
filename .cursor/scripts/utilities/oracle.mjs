#!/usr/bin/env node
/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/oracle.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8384
 * @external https://innotech.atlassian.net/browse/FE-8164
 * @external https://innotech.atlassian.net/browse/FE-7892
 * @external https://innotech.atlassian.net/browse/FE-7922
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * Oracle - Pantheon Cursor 同步腳本
 *
 * @module oracle
 * @purpose Pantheon 安裝內容同步至目標專案的 .cursor 與 .agents 目錄，並同步 .gitignore 與環境變數範本。
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
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 顏色輸出用常數物件。
 * @purpose 用於 log 的 UI 顏色渲染。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
/** @external */
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 統一的終端輸出（成功/警告/錯誤/資訊/灰階）。
 * @purpose 讓腳本在同步過程中有一致的提示格式。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
/** @external */
const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}🔄 ${msg}${colors.reset}`),
  dim: (msg) => console.log(`${colors.dim}   ${msg}${colors.reset}`),
};

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description .gitignore 片段區塊標題字串。
 * @purpose 用於定位/移除既有 Pantheon 安裝片段，避免重複寫入。
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
/** @external */
const GITIGNORE_SECTION_HEADER = "# Pantheon installed tooling";

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description bootstrap skill 檔案相對路徑。
 * @purpose 從多種候選位置搜尋並落地 pantheon-mounted-workflow/SKILL.md。
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
/** @external */
const BOOTSTRAP_SKILL_RELATIVE = join(
  "skills",
  "pantheon-mounted-workflow",
  "SKILL.md",
);

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 管理標記字串：判斷 SKILL.md 是否由腳本管理。
 * @purpose 在物件存在時避免覆蓋使用者自訂內容。
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
/** @external */
const BOOTSTRAP_SKILL_MANAGED_MARKER = "managed-by-pantheon-adapt";

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
 * 宣告內容用途說明與單號關聯
 *
 * @description 執行 shell 命令並回傳輸出（失敗時依設定處理）。
 * @purpose 供腳本使用 git/codegraph 等 CLI。
 * @external https://innotech.atlassian.net/browse/FE-7892
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
 * 宣告內容用途說明與單號關聯
 *
 * @description 檢查給定路徑是否為符號連結。
 * @purpose 用於判斷同步目標是否需用 unlink 移除。
 * @external https://innotech.atlassian.net/browse/FE-7892
 */
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 移除既有同步目標（包含舊版 symlink）。
 * @purpose 在複製目標前清理殘留。
 * @external https://innotech.atlassian.net/browse/FE-8164
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
 * 宣告內容用途說明與單號關聯
 *
 * @description 將來源目錄複製到目標專案（並在必要時清理舊目標）。
 * @purpose 用於把 .pantheon/.cursor 安裝產物複製到 .cursor 與 .agents。
 * @external https://innotech.atlassian.net/browse/FE-8164
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

function findBootstrapSkillSource(cwd, installFolderName) {
  const candidates = [
    join(cwd, ".pantheon", ".cursor", BOOTSTRAP_SKILL_RELATIVE),
    join(cwd, ".cursor", "skills", installFolderName, "pantheon-mounted-workflow", "SKILL.md"),
    join(cwd, ".agents", "skills", installFolderName, "pantheon-mounted-workflow", "SKILL.md"),
    join(cwd, ".agent", "skills", installFolderName, "pantheon-mounted-workflow", "SKILL.md"),
    join(cwd, ".cursor", BOOTSTRAP_SKILL_RELATIVE),
  ];
  return candidates.find((path) => existsSync(path)) || null;
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 落地 bootstrap skill（包含多目標落地與避免覆蓋自訂內容）。
 * @purpose 確保掛載後目標專案可讀取 pantheon-mounted-workflow/SKILL.md。
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
function materializeBootstrapSkill(cwd, installFolderName) {
  const sourcePath = findBootstrapSkillSource(cwd, installFolderName);
  if (!sourcePath) {
    log.warning("找不到 pantheon-mounted-workflow/SKILL.md，跳過 bootstrap 落地");
    return;
  }

  const sourceContent = readFileSync(sourcePath, "utf-8");
  const targetPaths = [
    join(cwd, ".cursor", BOOTSTRAP_SKILL_RELATIVE),
    join(cwd, ".agents", BOOTSTRAP_SKILL_RELATIVE),
  ];

  // 相容舊專案的 .agent 結構（僅在既有 .agent 目錄時才同步）
  if (existsSync(join(cwd, ".agent"))) {
    targetPaths.push(join(cwd, ".agent", BOOTSTRAP_SKILL_RELATIVE));
  }

  let updated = 0;
  let skipped = 0;

  for (const targetPath of targetPaths) {
    if (targetPath === sourcePath) {
      log.dim(`source 與目標相同，跳過: ${targetPath.replace(cwd, ".")}`);
      continue;
    }

    if (existsSync(targetPath)) {
      const targetContent = readFileSync(targetPath, "utf-8");

      if (
        !targetContent.includes(BOOTSTRAP_SKILL_MANAGED_MARKER) &&
        targetContent !== sourceContent
      ) {
        log.warning(`偵測到自訂 bootstrap skill，跳過覆蓋: ${targetPath.replace(cwd, ".")}`);
        skipped += 1;
        continue;
      }

      if (targetContent === sourceContent) {
        log.dim(`bootstrap skill 已是最新: ${targetPath.replace(cwd, ".")}`);
        continue;
      }
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, sourceContent, "utf-8");
    updated += 1;
    log.dim(`bootstrap skill: ${sourcePath.replace(cwd, ".")} -> ${targetPath.replace(cwd, ".")}`);
  }

  if (updated > 0) {
    log.success(`已落地 bootstrap skill（${updated} 個目標）`);
  } else if (skipped > 0) {
    log.warning("bootstrap skill 未更新（存在自訂內容）");
  } else {
    log.success("bootstrap skill 已是最新");
  }
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 將 Pantheon 安裝產物加入目標專案 .gitignore。
 * @purpose 透過刪除既有區塊再重寫，確保已列入正確安裝路徑（含 .cursor/.agents 與 .env.local）。
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
function updateGitignore(cwd, installFolderName) {
  const gitignorePath = join(cwd, ".gitignore");
  const entries = [
    ".pantheon/",
    ".codegraph/",
    ".cursor/.env.local",
    ".cursor/skills/pantheon-mounted-workflow/",
    `.cursor/commands/${installFolderName}/`,
    `.cursor/rules/${installFolderName}/`,
    `.cursor/scripts/${installFolderName}/`,
    `.cursor/skills/${installFolderName}/`,
    ".agents/skills/pantheon-mounted-workflow/",
    ".agent/skills/pantheon-mounted-workflow/",
    `.agents/commands/${installFolderName}/`,
    `.agents/rules/${installFolderName}/`,
    `.agents/scripts/${installFolderName}/`,
    `.agents/skills/${installFolderName}/`,
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
 * 宣告內容用途說明與單號關聯
 *
 * @description 在 pull 最新 Pantheon 後動態載入 codegraph-setup 模組並執行 init。
 * @purpose 確保 pantheon:oracle 即使從舊版 oracle.mjs 啟動，仍會使用最新 CodeGraph setup 邏輯（與 descend 一致）。
 * @external https://innotech.atlassian.net/browse/FE-8384
 */
async function runCodegraphSetup(cwd) {
  console.log("");
  console.log("🔍 自動準備 CodeGraph...");

  const setupModuleCandidates = [
    join(
      cwd,
      ".pantheon",
      ".cursor",
      "scripts",
      "utilities",
      "codegraph-setup.mjs",
    ),
    join(dirname(fileURLToPath(import.meta.url)), "codegraph-setup.mjs"),
  ];

  const setupModulePath = setupModuleCandidates.find((candidate) =>
    existsSync(candidate),
  );

  if (!setupModulePath) {
    log.warning("找不到 codegraph-setup 模組，跳過 CodeGraph 初始化");
    return;
  }

  try {
    const { setupCodegraph } = await import(pathToFileURL(setupModulePath).href);
    setupCodegraph({ cwd, log });
  } catch (error) {
    log.warning(`CodeGraph 初始化失敗：${error.message}`);
    log.warning(
      "查詢流程會自動回退到本地索引模式（不影響 Oracle 同步）",
    );
  }
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * @description 主程式：執行 Pantheon oracle 同步流程。
 * @purpose 整合 pantheon 拉取、目錄建立、安裝檔案複製、bootstrap 落地、.gitignore、CodeGraph、環境範本建立。
 * @external https://innotech.atlassian.net/browse/FE-7892
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
    join(cwd, ".agents", "commands"),
    join(cwd, ".agents", "rules"),
    join(cwd, ".agents", "scripts"),
    join(cwd, ".agents", "skills"),
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
      target: join(cwd, ".agents", "commands", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "rules"),
      target: join(cwd, ".agents", "rules", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "scripts"),
      target: join(cwd, ".agents", "scripts", installFolderName),
    },
    {
      source: join(cwd, ".pantheon", ".cursor", "skills"),
      target: join(cwd, ".agents", "skills", installFolderName),
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
  // 5. 落地 bootstrap skill（確保目標專案可讀）
  // ========================================
  console.log("");
  console.log("🧠 落地 Pantheon bootstrap skill...");
  materializeBootstrapSkill(cwd, installFolderName);

  // ========================================
  // 6. 更新 .gitignore
  // ========================================
  console.log("");
  console.log("🧹 更新 .gitignore...");
  updateGitignore(cwd, installFolderName);

  // ========================================
  // 7. 自動準備 CodeGraph（best effort，pull 後動態載入最新 setup 模組）
  // ========================================
  await runCodegraphSetup(cwd);

  // ========================================
  // 8. 檢查並建立環境變數配置檔
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
  // 9. 輸出結果
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
  console.log(".agents/");
  console.log("├── commands/");
  console.log(`│   └── ${installFolderName}/`);
  console.log("├── rules/");
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
    console.log("  - REVIEWER_AGENT_API_TOKEN: Reviewer Agent API Token（舊名 COMPASS_API_TOKEN 仍相容）");
    console.log("  - REVIEWER_AGENT_API_URL: Reviewer Agent API base URL（預設 mac09demac-mini / Compass）");
    console.log("");
  }

  console.log("");
}

// 執行主程式
main().catch((error) => {
  log.error(`執行失敗: ${error.message}`);
  process.exit(1);
});

/**
 * llm 分析紀錄區
 *
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactoring-engine
 * @llm-review-note 依規範補齊三段式註解區塊，並在可對應的宣告處加入 @description/@purpose/@external（使用 input.declarationOrigins 的票據）。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T18:05:10.338Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Refactor comments only: added required three-section file header, enriched selected declaration comments with ticket-linked @description/@purpose/@external using declarationOrigins, and appended required llm analysis record block. Runtime logic unchanged.
 */

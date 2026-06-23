#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getProjectRoot } from "./env-loader.mjs";

/**
 * 宣告內容用途說明與單號關聯
 *
 * 用 env-loader.mjs 解析出的專案根目錄，作為後續 Pantheon 來源路徑與目標路徑的基準。
 * @description Project root resolved via env-loader.
 * @purpose 統一以專案根目錄計算路徑。
 * @external https://innotech.atlassian.net/browse/FE-8076
 */
const projectRoot = getProjectRoot();

/**
 * 宣告內容用途說明與單號關聯
 *
 * 定義 Pantheon bootstrap skill 的來源相對路徑、目標技能名稱，以及避免覆蓋的 managed 標記。
 * @description Source/target metadata for the Pantheon bootstrap skill that will be copied into Cursor skill locations.
 * @purpose 供來源探測與目標檔案寫入時使用。
 * @external https://innotech.atlassian.net/browse/FE-8076
 */
const BOOTSTRAP_SKILL = {
  name: "pantheon-mounted-workflow",
  relativePath: join(".cursor", "skills", "pantheon-mounted-workflow", "SKILL.md"),
  managedMarker: "managed-by-pantheon-adapt",
};

/**
 * 宣告內容用途說明與單號關聯
 *
 * 依據檔案路徑推導出其父目錄；若父目錄不存在則建立，確保後續可成功寫入檔案。
 * @description Ensure the parent directory for a given file path exists.
 * @purpose 建立目標目錄以支援檔案落地。
 * @external https://innotech.atlassian.net/browse/FE-8076
 */
function ensureDirForFile(filePath) {
  // Parent directory path derived from file path.
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * 嘗試從多個可能的安裝/拷貝佈局中找出 bootstrap skill 的第一個可用來源檔案。
 * @description Find the first available source path for the bootstrap skill.
 * @purpose 支援不同安裝路徑/目錄佈局。
 * @external https://innotech.atlassian.net/browse/FE-8076
 */
function getSourcePath() {
  // Candidate source locations to support different installed/copy layouts.
  const candidates = [
    join(projectRoot, ".pantheon", BOOTSTRAP_SKILL.relativePath),
    join(projectRoot, BOOTSTRAP_SKILL.relativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * 計算需要被寫入的所有目標路徑（Cursor/Agent skill 位置）；並保留對部分專案仍使用 ".agent" 資料夾的相容性。
 * @description Compute all target paths where the bootstrap skill should be written.
 * @purpose 將同一份指引同步到多個 skill 目錄。
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
function getTargetPaths() {
  const targets = [
    join(projectRoot, ".cursor", "skills", BOOTSTRAP_SKILL.name, "SKILL.md"),
    join(projectRoot, ".agents", "skills", BOOTSTRAP_SKILL.name, "SKILL.md"),
  ];

  // Compatibility: some projects still use ".agent" folder.
  const singularAgentPath = join(projectRoot, ".agent");
  if (existsSync(singularAgentPath)) {
    targets.push(join(projectRoot, ".agent", "skills", BOOTSTRAP_SKILL.name, "SKILL.md"));
  }

  return targets;
}

/**
 * 宣告內容用途說明與單號關聯
 *
 * 探測來源、讀取內容，並將 bootstrap skill 寫入所有目標位置；若偵測到目標已存在且非 managed 內容則跳過避免覆蓋。
 * @description Copy the bootstrap skill content from the detected source to all eligible target locations.
 * @purpose 執行一次性落地/同步動作。
 * @external https://innotech.atlassian.net/browse/FE-8076
 * @external https://innotech.atlassian.net/browse/FE-8164
 */
function main() {
  const sourcePath = getSourcePath();
  if (!sourcePath) {
    console.log("ℹ️  找不到 Pantheon bootstrap skill 來源，跳過 guideline 落地化");
    return;
  }

  const sourceContent = readFileSync(sourcePath, "utf-8");
  const targets = getTargetPaths();

  let updatedCount = 0;
  let skippedCount = 0;

  for (const targetPath of targets) {
    if (sourcePath === targetPath) {
      console.log(`ℹ️  source 與目標相同，跳過：${targetPath}`);
      continue;
    }

    if (existsSync(targetPath)) {
      const targetContent = readFileSync(targetPath, "utf-8");

      if (
        !targetContent.includes(BOOTSTRAP_SKILL.managedMarker) &&
        targetContent !== sourceContent
      ) {
        console.log(
          `⚠️  偵測到既有自訂 skill：${targetPath}，為避免覆蓋使用者內容，本次跳過更新`,
        );
        skippedCount += 1;
        continue;
      }

      if (targetContent === sourceContent) {
        console.log(`ℹ️  Pantheon bootstrap skill 已是最新：${targetPath}`);
        continue;
      }
    }

    ensureDirForFile(targetPath);
    writeFileSync(targetPath, sourceContent, "utf-8");
    updatedCount += 1;
    console.log(`🧠 已落地 Pantheon bootstrap skill：${targetPath}`);
  }

  if (updatedCount === 0 && skippedCount === 0) {
    console.log("ℹ️  沒有需要更新的 bootstrap skill 目標");
  }
}

main();
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:31:27.185Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Adjusted comments only to enforce required three-section annotation layout at top/middle/bottom, and normalized all @external entries to full Jira browse URLs while keeping runtime logic unchanged.
 */

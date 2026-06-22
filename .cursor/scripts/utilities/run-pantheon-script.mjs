#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/run-pantheon-script.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8164
 * @external https://innotech.atlassian.net/browse/FE-8017
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */

/**
 * 檔案用途區塊
 * @module run-pantheon-script
 * @purpose 路徑韌性（path-resilient）地解析並執行 Pantheon 指定腳本
 * - 避免在 mounted (.pantheon) / 安裝拷貝環境中出現「script not found」問題
 */

/**
 * Pantheon script runner (path-resilient wrapper)
 *
 * Purpose:
 * - Avoid "script not found" issues in mounted (.pantheon) / installed-copy environments.
 * - Resolve script path from multiple known roots, then execute with Node.
 *
 * Usage:
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs <script> [--] [...args]
 *
 * Examples:
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs cr/create-mr.mjs -- --target=main
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/agent-log.mjs -- --action=show-config
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/agent-communicator.mjs -- --action=show-config
 *
 * Notes:
 * - <script> can be:
 *   - "cr/create-mr.mjs" (relative to ".cursor/scripts/")
 *   - ".cursor/scripts/cr/create-mr.mjs"
 *   - absolute path
 */

import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { isAbsolute, join, normalize } from "path";
import { getProjectRoot } from "./env-loader.mjs";

/**
 * 宣告內容用途說明與單號關聯
 * @description 印出用法說明並在未提供必要參數時結束
 * @purpose 用於 FE-8017 的腳本執行路徑加固情境：缺少目標腳本時終止流程
 * - fix(FE-8017): harden script execution paths
 */
function printUsageAndExit() {
  console.error(`
🧭 Pantheon Script Runner

Usage:
  node .cursor/scripts/utilities/run-pantheon-script.mjs <script> [--] [...args]

Script path formats:
  - cr/create-mr.mjs
  - utilities/agent-log.mjs
  - utilities/agent-communicator.mjs
  - client/llm-client.mjs
  - .cursor/scripts/cr/create-mr.mjs
  - /abs/path/to/script.mjs

Examples:
  node .cursor/scripts/utilities/run-pantheon-script.mjs cr/create-mr.mjs -- --target=main
  node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/agent-log.mjs -- --action=show-config
`.trim());
  process.exit(1);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將 CLI args 分割為「腳本規格」與「轉傳參數」
 * @purpose 用於 FE-8017 的 CLI 參數解析保護：確保 script 與 forwarded args 的取得正確
 * - fix(FE-8017): harden script execution paths
 */
function splitArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  if (args.length === 0) return { script: null, forward: [] };

  const script = args[0];
  const rest = args.slice(1);
  if (rest[0] === "--") return { script, forward: rest.slice(1) };
  return { script, forward: rest };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 將使用者輸入的腳本規格做正規化，必要時轉成相對於 .cursor/scripts 的形式
 * @purpose 用於 FE-8017 的腳本路徑加固：容許使用者提供 .cursor/scripts/xxx 的輸入並轉換成內部處理格式
 * - fix(FE-8017): harden script execution paths
 */
function normalizeScriptSpecifier(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  // Allow users to pass ".cursor/scripts/xxx.mjs"
  const normalized = normalize(s).replace(/\\/g, "/");
  if (normalized.startsWith(".cursor/scripts/")) {
    return normalized.slice(".cursor/scripts/".length);
  }
  if (normalized.startsWith("./.cursor/scripts/")) {
    return normalized.slice("./.cursor/scripts/".length);
  }
  return normalized;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 於指定根目錄下列出安裝（installed copy）腳本的候選路徑
 * @purpose 用於 FE-8164 的目錄對齊：支援 agents 目錄內的 installed copies 佈局
 * - update(FE-8164): align pantheon installed copy paths
 */
function listInstalledScriptCandidates(rootDir, rel) {
  if (!existsSync(rootDir)) return [];

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => join(rootDir, dirent.name, rel));
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 為指定腳本規格建構所有可能的絕對路徑清單
 * @purpose 用於 FE-8017 的路徑加固：將 mounted/.cursor 以及 installed copies 來源納入候選
 * - fix(FE-8017): harden script execution paths
 */
function buildCandidatePaths(projectRoot, scriptSpecifier) {
  const rel = normalizeScriptSpecifier(scriptSpecifier);
  if (!rel) return [];

  // Absolute path: use as-is
  if (isAbsolute(rel)) return [rel];

  return [
    // Mounted pantheon
    join(projectRoot, ".pantheon", ".cursor", "scripts", rel),
    // Pantheon repo itself
    join(projectRoot, ".cursor", "scripts", rel),
    // Installed Pantheon copies in target projects
    ...listInstalledScriptCandidates(join(projectRoot, ".cursor", "scripts"), rel),
    ...listInstalledScriptCandidates(join(projectRoot, ".agents", "scripts"), rel),
    ...listInstalledScriptCandidates(join(projectRoot, ".agent", "scripts"), rel),
  ];
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析並執行目標腳本，並攜帶轉傳參數
 * @purpose 用於 FE-8017 的腳本執行流程加固：嘗試候選路徑、找不到則提示並終止
 * - fix(FE-8017): harden script execution paths
 */
function main() {
  const projectRoot = getProjectRoot();
  const { script, forward } = splitArgs(process.argv);
  if (!script) printUsageAndExit();

  const candidates = buildCandidatePaths(projectRoot, script);
  const found = candidates.find((p) => existsSync(p));

  if (!found) {
    console.error(`\n❌ 找不到目標腳本：${script}\n`);
    console.error("已嘗試以下路徑：");
    for (const p of candidates) console.error(`- ${p}`);
    console.error(
      "\n💡 建議：確認你提供的 <script> 是相對於 .cursor/scripts/ 的路徑，例如 cr/create-mr.mjs\n",
    );
    process.exit(1);
  }

  console.log(`🟢 使用腳本：${found}`);
  if (forward.length > 0) console.log(`➡️  轉傳參數：${forward.join(" ")}`);

  const result = spawnSync(process.execPath, [found, ...forward], {
    stdio: "inherit",
    env: process.env,
    cwd: projectRoot,
  });

  if (result.error) {
    console.error(`\n❌ 執行失敗：${result.error.message}\n`);
    process.exit(1);
  }

  process.exit(typeof result.status === "number" ? result.status : 1);
}

main();

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactoring-engine
 * @llm-review-note 僅更新註解格式：補齊三段式區塊、調整 @style 標籤並依 declarationOrigins 填入外部關聯資訊；不變更執行邏輯。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T18:07:13.734Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Refactored only JSDoc comments to conform to the required three-section annotation layout and updated declaration comment blocks with @description/@purpose/@external derived from provided declarationOrigins. Runtime logic was unchanged.
 */

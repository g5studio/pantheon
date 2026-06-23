#!/usr/bin/env node
/**
 * 檔案用途區塊
 * @module codegraph-setup
 * @purpose 提供 CodeGraph runtime 偵測、專案 init 與 oracle/descend 共用的 best-effort setup 流程
 * @external https://innotech.atlassian.net/browse/FE-8384
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/**
 * 宣告內容用途說明與單號關聯
 * @description CodeGraph npx 執行 prefix（免全域安裝）。
 * @purpose 供 resolve runtime 與 init 共用。
 */
export const CODEGRAPH_NPX_PREFIX = "npx -y @colbymchenry/codegraph";

/**
 * 宣告內容用途說明與單號關聯
 * @description 預設終端輸出（未傳入 log 時使用）。
 * @purpose 讓 query-file 等腳本可直接呼叫 setup 而不必帶入 oracle 的 log 物件。
 */
const defaultLog = {
  success: (msg) => console.log(`✅ ${msg}`),
  warning: (msg) => console.warn(`⚠️  ${msg}`),
  info: (msg) => console.log(`🔄 ${msg}`),
};

/**
 * 宣告內容用途說明與單號關聯
 * @description 執行 shell 命令。
 * @purpose 供 runtime 偵測與 init 使用。
 */
function runCommand(command, cwd) {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 取得專案根目錄下的 .codegraph 路徑。
 * @purpose 統一 index 目錄位置判斷。
 */
function getCodegraphDir(cwd) {
  return join(cwd, ".codegraph");
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 檢查本機 codegraph CLI 是否可用。
 * @purpose runtime 解析第一優先。
 */
export function hasCodegraphCli(cwd) {
  try {
    runCommand("codegraph --version", cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 檢查專案是否已存在 CodeGraph index。
 * @purpose 避免重複 init。
 */
export function hasCodegraphIndex(cwd) {
  return existsSync(getCodegraphDir(cwd));
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 檢查 npx @colbymchenry/codegraph 是否可用。
 * @purpose runtime 解析 fallback。
 */
export function hasCodegraphNpx(cwd) {
  try {
    runCommand(`${CODEGRAPH_NPX_PREFIX} --version`, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 解析可用的 CodeGraph runtime（本機 CLI 或 npx）。
 * @purpose 供 query-file 與 oracle 共用同一套優先順序。
 */
export function resolveCodegraphRuntime(cwd) {
  if (hasCodegraphCli(cwd)) {
    return { available: true, mode: "cli", prefix: "codegraph" };
  }
  if (hasCodegraphNpx(cwd)) {
    return { available: true, mode: "npx", prefix: CODEGRAPH_NPX_PREFIX };
  }
  return { available: false, mode: null, prefix: null };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 在 runtime 可用時確保 .codegraph index 存在。
 * @purpose query-file 查詢前自動 init。
 */
export function ensureCodegraphIndex(cwd, runtime) {
  if (!runtime?.available || !runtime.prefix) {
    return { ok: false, initialized: false };
  }
  if (hasCodegraphIndex(cwd)) {
    return { ok: true, initialized: false };
  }

  try {
    runCommand(`${runtime.prefix} init`, cwd);
  } catch {
    return { ok: false, initialized: false };
  }

  const initialized = hasCodegraphIndex(cwd);
  return { ok: initialized, initialized };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 嘗試以指定 prefix 執行 codegraph init。
 * @purpose setup 流程內部使用。
 */
function tryInitWithPrefix(cwd, prefix) {
  try {
    runCommand(`${prefix} init`, cwd);
    return hasCodegraphIndex(cwd);
  } catch {
    return false;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description best-effort 準備 CodeGraph（與 descend/oracle 共用）。
 * @purpose 偵測缺少 runtime 或 index 時自動 init，失敗不阻斷主流程。
 */
export function setupCodegraph({ cwd, log = defaultLog } = {}) {
  if (!cwd) {
    log.warning("CodeGraph setup 缺少 cwd，已跳過");
    return { ok: false, mode: null, initialized: false };
  }

  const codegraphDir = getCodegraphDir(cwd);

  if (existsSync(codegraphDir)) {
    log.success("CodeGraph 已初始化（.codegraph 已存在）");
    return { ok: true, mode: "existing", initialized: false };
  }

  log.info("檢查並初始化 CodeGraph...");

  const runtime = resolveCodegraphRuntime(cwd);

  if (runtime.available) {
    const result = ensureCodegraphIndex(cwd, runtime);
    if (result.ok) {
      const modeLabel =
        runtime.mode === "cli"
          ? "本機 codegraph CLI"
          : "npx @colbymchenry/codegraph";
      log.success(`已完成 CodeGraph 初始化（使用 ${modeLabel}）`);
      return { ok: true, mode: runtime.mode, initialized: true };
    }
    log.warning(`CodeGraph init 失敗（${runtime.mode}）`);
  }

  if (tryInitWithPrefix(cwd, CODEGRAPH_NPX_PREFIX)) {
    log.success("已完成 CodeGraph 初始化（使用 npx @colbymchenry/codegraph）");
    return { ok: true, mode: "npx", initialized: true };
  }

  if (hasCodegraphCli(cwd) && tryInitWithPrefix(cwd, "codegraph")) {
    log.success("已完成 CodeGraph 初始化（使用本機 codegraph CLI）");
    return { ok: true, mode: "cli", initialized: true };
  }

  log.warning(
    "CodeGraph 初始化未完成，查詢流程會自動回退到本地索引模式（不影響 Oracle 同步）",
  );
  return { ok: false, mode: null, initialized: false };
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-15T00:00:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 抽出 CodeGraph setup 共用模組，供 oracle 在 pull 後動態載入最新邏輯。
 */

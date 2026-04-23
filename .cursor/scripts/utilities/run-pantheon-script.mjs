#!/usr/bin/env node

/**
 * Pantheon script runner (path-resilient wrapper)
 *
 * Purpose:
 * - Avoid "script not found" issues in mounted (.pantheon) / symlinked environments.
 * - Resolve script path from multiple known roots, then execute with Node.
 *
 * Usage:
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs <script> [--] [...args]
 *
 * Examples:
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs cr/create-mr.mjs -- --target=main
 *   node .cursor/scripts/utilities/run-pantheon-script.mjs operator/update-development-report.mjs -- --read
 *
 * Notes:
 * - <script> can be:
 *   - "cr/create-mr.mjs" (relative to ".cursor/scripts/")
 *   - ".cursor/scripts/cr/create-mr.mjs"
 *   - absolute path
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { isAbsolute, join, normalize } from "path";
import { getProjectRoot } from "./env-loader.mjs";

function printUsageAndExit() {
  console.error(`
🧭 Pantheon Script Runner

Usage:
  node .cursor/scripts/utilities/run-pantheon-script.mjs <script> [--] [...args]

Script path formats:
  - cr/create-mr.mjs
  - operator/start-task.mjs
  - .cursor/scripts/cr/create-mr.mjs
  - /abs/path/to/script.mjs

Examples:
  node .cursor/scripts/utilities/run-pantheon-script.mjs cr/create-mr.mjs -- --target=main
  node .cursor/scripts/utilities/run-pantheon-script.mjs operator/update-development-report.mjs -- --read
`.trim());
  process.exit(1);
}

function splitArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  if (args.length === 0) return { script: null, forward: [] };

  const script = args[0];
  const rest = args.slice(1);
  if (rest[0] === "--") return { script, forward: rest.slice(1) };
  return { script, forward: rest };
}

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
    // Some workspaces aggregate via symlink folder
    join(projectRoot, ".cursor", "scripts", "prometheus", rel),
  ];
}

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


#!/usr/bin/env node

/**
 * 將 start-task-info.json 的 resultVerified 設為 true（檔案化）
 *
 * 使用方式：
 *   node .cursor/scripts/operator/confirm-result-verified.mjs --ticket="FE-1234"
 *   node .cursor/scripts/operator/confirm-result-verified.mjs --start-task-dir=".cursor/tmp/FE-1234"
 *   node .cursor/scripts/operator/confirm-result-verified.mjs --start-task-info-file=".cursor/tmp/FE-1234/start-task-info.json"
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import { getProjectRoot } from "../utilities/env-loader.mjs";

const projectRoot = getProjectRoot();

function resolvePathFromProjectRoot(filePath) {
  if (!filePath) return null;
  return isAbsolute(filePath) ? filePath : join(projectRoot, filePath);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveInfoFile({ ticket, startTaskDir, startTaskInfoFile } = {}) {
  if (startTaskInfoFile) return resolvePathFromProjectRoot(startTaskInfoFile);
  if (startTaskDir) {
    return join(resolvePathFromProjectRoot(startTaskDir), "start-task-info.json");
  }
  if (ticket) {
    return join(projectRoot, ".cursor", "tmp", ticket, "start-task-info.json");
  }
  return join(projectRoot, ".cursor", "tmp", "start-task-info.json");
}

function main() {
  const args = process.argv.slice(2);
  let ticket = null;
  let startTaskDir = null;
  let startTaskInfoFile = null;

  for (const arg of args) {
    if (arg.startsWith("--ticket=")) ticket = arg.slice("--ticket=".length).trim().toUpperCase();
    else if (arg.startsWith("--start-task-dir=")) startTaskDir = arg.slice("--start-task-dir=".length);
    else if (arg.startsWith("--start-task-info-file=")) startTaskInfoFile = arg.slice("--start-task-info-file=".length);
  }

  const infoFile = resolveInfoFile({ ticket, startTaskDir, startTaskInfoFile });
  if (!existsSync(infoFile)) {
    console.error(`❌ 找不到 start-task-info.json：${infoFile}`);
    process.exit(1);
  }

  const raw = readFileSync(infoFile, "utf-8").replace(/^\uFEFF/, "").trim();
  const info = safeJsonParse(raw);
  if (!info) {
    console.error(`❌ start-task-info.json 解析失敗：${infoFile}`);
    process.exit(1);
  }

  info.resultVerified = true;
  info.resultVerifiedAt = new Date().toISOString();
  writeFileSync(infoFile, JSON.stringify(info, null, 2), "utf-8");
  console.log("✅ 已確認結果驗證（resultVerified=true）");
  console.log(`   - ${infoFile}\n`);
}

main();


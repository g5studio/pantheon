#!/usr/bin/env node

/**
 * 更新開發計劃到 .cursor/tmp（檔案化）
 *
 * 使用方式：
 *   node .cursor/scripts/operator/update-development-plan.mjs --plan="<plan-content>"
 *   node .cursor/scripts/operator/update-development-plan.mjs --plan-file="<path-to-plan-file>"
 *   node .cursor/scripts/operator/update-development-plan.mjs --ticket="FE-1234" --plan-file="..."
 *   node .cursor/scripts/operator/update-development-plan.mjs --start-task-dir=".cursor/tmp/FE-1234" --plan-file="..."
 *   node .cursor/scripts/operator/update-development-plan.mjs --start-task-info-file=".cursor/tmp/FE-1234/start-task-info.json" --plan-file="..."
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
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

function resolveStartTaskPaths({ ticket, startTaskDir, startTaskInfoFile } = {}) {
  const dir = startTaskDir
    ? resolvePathFromProjectRoot(startTaskDir)
    : ticket
      ? join(projectRoot, ".cursor", "tmp", ticket)
      : null;

  const infoFile = startTaskInfoFile
    ? resolvePathFromProjectRoot(startTaskInfoFile)
    : dir
      ? join(dir, "start-task-info.json")
      : join(projectRoot, ".cursor", "tmp", "start-task-info.json");

  const planFile = dir ? join(dir, "development-plan.md") : null;
  return { dir, infoFile, planFile };
}

function main() {
  const args = process.argv.slice(2);

  let planContent = null;
  let planFile = null;
  let ticket = null;
  let startTaskDir = null;
  let startTaskInfoFile = null;
  let confirmed = null; // RD confirmed 開發計劃（planConfirmed）

  for (const arg of args) {
    if (arg.startsWith("--plan=")) {
      planContent = arg.slice("--plan=".length);
    } else if (arg.startsWith("--plan-file=")) {
      planFile = arg.slice("--plan-file=".length);
    } else if (arg.startsWith("--ticket=")) {
      ticket = arg.slice("--ticket=".length).trim().toUpperCase();
    } else if (arg.startsWith("--start-task-dir=")) {
      startTaskDir = arg.slice("--start-task-dir=".length);
    } else if (arg.startsWith("--start-task-info-file=")) {
      startTaskInfoFile = arg.slice("--start-task-info-file=".length);
    } else if (arg.startsWith("--confirmed=")) {
      const v = arg.slice("--confirmed=".length).trim().toLowerCase();
      confirmed = v === "true" ? true : v === "false" ? false : null;
    } else if (arg.startsWith("--plan-confirmed=")) {
      const v = arg.slice("--plan-confirmed=".length).trim().toLowerCase();
      confirmed = v === "true" ? true : v === "false" ? false : null;
    }
  }

  if (planFile) {
    if (!existsSync(planFile)) {
      console.error(`❌ 找不到計劃檔案: ${planFile}`);
      process.exit(1);
    }
    planContent = readFileSync(planFile, "utf-8");
  }

  // 允許「只更新 confirmed 狀態」而不改 plan 內容
  if (planContent || confirmed !== null) {
    const { infoFile, planFile: defaultPlanFile } = resolveStartTaskPaths({
      ticket,
      startTaskDir,
      startTaskInfoFile,
    });

    if (!existsSync(infoFile)) {
      console.error(`❌ 找不到 start-task-info.json：${infoFile}`);
      process.exit(1);
    }

    const raw = readFileSync(infoFile, "utf-8").replace(/^\uFEFF/, "").trim();
    const startTaskInfo = safeJsonParse(raw);
    if (!startTaskInfo) {
      console.error(`❌ start-task-info.json 解析失敗：${infoFile}`);
      process.exit(1);
    }

    if (planContent) {
      const planOut = startTaskInfo.developmentPlanFile
        ? resolvePathFromProjectRoot(startTaskInfo.developmentPlanFile)
        : defaultPlanFile;
      if (!planOut) {
        console.error("❌ 無法推斷 development-plan.md 路徑");
        process.exit(1);
      }

      writeFileSync(planOut, planContent, "utf-8");
      startTaskInfo.aiDevelopmentPlan = true;
      console.log("✅ 已更新開發計劃（檔案化）");
      console.log(`   - plan: ${planOut}`);
    }

    if (confirmed !== null) {
      startTaskInfo.planConfirmed = confirmed;
      console.log(`✅ 已更新 planConfirmed: ${String(confirmed)}`);
    }
    startTaskInfo.updatedAt = new Date().toISOString();
    writeFileSync(infoFile, JSON.stringify(startTaskInfo, null, 2), "utf-8");
    console.log(`   - info: ${infoFile}\n`);
    return;
  }

  console.log(`
📝 開發計劃更新工具

使用方式：
  node .cursor/scripts/operator/update-development-plan.mjs --plan="<plan-content>"
  node .cursor/scripts/operator/update-development-plan.mjs --plan-file="<path-to-plan-file>"
  node .cursor/scripts/operator/update-development-plan.mjs --ticket="FE-1234" --plan-file="..."
  node .cursor/scripts/operator/update-development-plan.mjs --start-task-dir=".cursor/tmp/FE-1234" --plan-file="..."
  node .cursor/scripts/operator/update-development-plan.mjs --start-task-info-file=".cursor/tmp/FE-1234/start-task-info.json" --plan-file="..."
  node .cursor/scripts/operator/update-development-plan.mjs --ticket="FE-1234" --confirmed=true
`);
}

main();


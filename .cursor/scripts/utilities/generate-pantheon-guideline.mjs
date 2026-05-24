#!/usr/bin/env node

/**
 * generate-pantheon-guideline
 *
 * Materialize Pantheon bootstrap guidance into the target project so the agent
 * can still read Pantheon usage instructions even when mounted paths or
 * generated installed content are not discoverable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getProjectRoot } from "./env-loader.mjs";

const projectRoot = getProjectRoot();

const BOOTSTRAP_SKILL = {
  name: "pantheon-mounted-workflow",
  relativePath: join(".cursor", "skills", "pantheon-mounted-workflow", "SKILL.md"),
  managedMarker: "managed-by-pantheon-adapt",
};

function ensureDirForFile(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getSourcePath() {
  const candidates = [
    join(projectRoot, ".pantheon", BOOTSTRAP_SKILL.relativePath),
    join(projectRoot, BOOTSTRAP_SKILL.relativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

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

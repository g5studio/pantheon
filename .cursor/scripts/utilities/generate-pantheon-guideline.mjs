#!/usr/bin/env node

/**
 * generate-pantheon-guideline
 *
 * Materialize Pantheon bootstrap guidance into the target project so the agent
 * can still read Pantheon usage instructions even when mounted paths or
 * symlinked content are not discoverable.
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

function main() {
  const sourcePath = getSourcePath();
  if (!sourcePath) {
    console.log("ℹ️  找不到 Pantheon bootstrap skill 來源，跳過 guideline 落地化");
    return;
  }

  const targetPath = join(projectRoot, ".cursor", "skills", BOOTSTRAP_SKILL.name, "SKILL.md");
  if (sourcePath === targetPath) {
    console.log(`ℹ️  已在本地 source repo 中：${targetPath}`);
    return;
  }

  const sourceContent = readFileSync(sourcePath, "utf-8");

  if (existsSync(targetPath)) {
    const targetContent = readFileSync(targetPath, "utf-8");

    if (!targetContent.includes(BOOTSTRAP_SKILL.managedMarker) && targetContent !== sourceContent) {
      console.log(
        `⚠️  偵測到既有自訂 skill：${targetPath}，為避免覆蓋使用者內容，本次跳過更新`,
      );
      return;
    }

    if (targetContent === sourceContent) {
      console.log(`ℹ️  Pantheon bootstrap skill 已是最新：${targetPath}`);
      return;
    }
  }

  ensureDirForFile(targetPath);
  writeFileSync(targetPath, sourceContent, "utf-8");
  console.log(`🧠 已落地 Pantheon bootstrap skill：${targetPath}`);
}

main();

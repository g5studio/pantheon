#!/usr/bin/env node

/**
 * Agent Version - 版本資訊讀取工具
 *
 * 目的：
 * - 在未傳入 --agent-version 時，仍能自動從 repo 中推導版本資訊
 * - 避免 MR / 開發報告缺失 Agent Version 區塊
 *
 * 探測順序（依規範）：
 * 1) .pantheon/version.json
 * 2) version.json
 * 3) .cursor/version.json
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "./env-loader.mjs";

const projectRoot = getProjectRoot();

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryReadJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "").trim();
    if (!raw) return null;
    return safeJsonParse(raw);
  } catch {
    return null;
  }
}

export function readAgentVersionInfo() {
  const candidates = [
    join(projectRoot, ".pantheon", "version.json"),
    join(projectRoot, "version.json"),
    join(projectRoot, ".cursor", "version.json"),
  ];

  for (const p of candidates) {
    const parsed = tryReadJson(p);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}


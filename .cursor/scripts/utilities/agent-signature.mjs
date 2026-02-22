#!/usr/bin/env node

import { execSync } from "child_process";
import { getAgentDisplayName } from "./env-loader.mjs";

function getGitUserName() {
  try {
    const name = execSync("git config --get user.name", {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return name || null;
  } catch {
    return null;
  }
}

function buildAgentSignatureLine(displayName) {
  const owner = getGitUserName();
  if (owner) return `— ${owner}的AI助理『${displayName}』`;
  return `— AI助理『${displayName}』`;
}

/**
 * 在訊息末尾追加署名（若未設定 AGENT_DISPLAY_NAME，則完全不改動原字串）
 *
 * CRITICAL:
 * - 未設定時，必須回傳原始 message（完全不變）
 * - 署名必須為最後一行
 * - 重複呼叫需具備 idempotent（避免重複追加同一署名）
 *
 * @param {string} message
 * @returns {string}
 */
export function appendAgentSignature(message) {
  if (typeof message !== "string") return message;

  const displayName = getAgentDisplayName();
  if (!displayName) return message;

  const signatureLine = buildAgentSignatureLine(displayName);

  // 僅在需要追加署名時，才做輕度 normalize：移除尾端換行，避免署名前出現多餘空白行
  const base = message.replace(/[\r\n]+$/g, "");

  // 若最後一個非空白行已是相同署名，避免重複追加
  const lines = base.split(/\r?\n/);
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === "") i--;
  const lastNonEmpty = i >= 0 ? lines[i] : "";
  // 若已存在署名，仍需確保「署名為最後一行」（移除尾端多餘換行）
  if (lastNonEmpty === signatureLine) return base;

  if (!base) return signatureLine;
  return `${base}\n${signatureLine}`;
}

/**
 * 移除訊息末尾署名（若存在）
 *
 * 用途：
 * - 在需要於尾端插入其他區塊（例如 Agent Version）前，先移除尾端署名，避免署名被推到中間
 * - 更新 MR description 前先移除舊署名，再追加新內容後重新署名
 * - 避免署名重複堆疊
 *
 * @param {string} message
 * @returns {string}
 */
export function stripTrailingAgentSignature(message) {
  if (typeof message !== "string") return message;

  const displayName = getAgentDisplayName();
  const base = message.replace(/[\r\n]+$/g, "");
  if (!base) return message;

  const lines = base.split(/\r?\n/);
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === "") i--;
  if (i < 0) return message;

  const lastNonEmpty = lines[i];

  // 若能取得 displayName，先做精準移除（避免誤刪其他行）
  if (displayName) {
    const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const signatureRegex = new RegExp(`^—\\s+.*AI助理『${escaped}』$`);
    if (signatureRegex.test(lastNonEmpty)) {
      return lines.slice(0, i).join("\n").replace(/[\r\n]+$/g, "");
    }
  }

  // fallback：只要符合署名格式就移除（兼容：— {owner}的AI助理『...』 / — AI助理『...』）
  const isSignatureLine =
    typeof lastNonEmpty === "string" &&
    lastNonEmpty.trim().startsWith("— ") &&
    lastNonEmpty.includes("AI助理『") &&
    lastNonEmpty.trim().endsWith("』");
  if (!isSignatureLine) return message;

  const kept = lines.slice(0, i).join("\n").replace(/[\r\n]+$/g, "");
  return kept;
}


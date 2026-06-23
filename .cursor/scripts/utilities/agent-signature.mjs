#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/agent-signature.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8003
 * @external https://innotech.atlassian.net/browse/FE-8007
 * @external https://innotech.atlassian.net/browse/FE-8004
 */

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */

/**
 * === 檔案用途區塊 ===
 * @module agent-signature
 * @purpose 管理文字末尾的「代理署名」：在必要時追加、在必要時移除。
 * @external https://innotech.atlassian.net/browse/FE-8004
 */

import { execSync } from "child_process";
import { getAgentDisplayName } from "./env-loader.mjs";

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 讀取本地 Git 設定中的 user.name；失敗或為空則回傳 null（不拋例外）。
 * @purpose 用於決定署名格式是否包含「{owner}的AI助理」。
 * @external https://innotech.atlassian.net/browse/FE-8004
 */
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

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 依 Git user.name 是否存在，建立署名單行字串；不含尾端換行。
 * @purpose 用於產生「— {owner}的AI助理『{displayName}』」或「— AI助理『{displayName}』」。
 * @external https://innotech.atlassian.net/browse/FE-8004
 */
function buildAgentSignatureLine(displayName) {
  const owner = getGitUserName();
  if (owner) return `— ${owner}的AI助理『${displayName}』`;
  return `— AI助理『${displayName}』`;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 在訊息末尾追加代理署名（若 AGENT_DISPLAY_NAME 未設定則完全不改動原字串）。
 * @purpose 保證 idempotent：避免重複追加同一署名；署名會成為最後一行。
 * @external https://innotech.atlassian.net/browse/FE-8004
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
  if (lastNonEmpty === signatureLine) return message;

  if (!base) return signatureLine;
  return `${base}\n${signatureLine}`;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 移除尾端的代理署名（僅處理尾端；會先修剪尾端多餘換行以正確辨識最後一行）。
 * @purpose 在訊息結尾符合署名樣式時移除最後一個非空行並保留前文內容。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
export function stripTrailingAgentSignature(message) {
  if (typeof message !== "string") return message;

  // 只處理尾端：先去掉尾端多餘換行，避免最後一行是空白
  const base = message.replace(/[\r\n]+$/g, "");
  if (!base) return message;

  const lines = base.split(/\r?\n/);
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === "") i--;
  const lastNonEmpty = i >= 0 ? lines[i] : "";

  // 兼容格式：— {owner}的AI助理『{displayName}』 / — AI助理『{displayName}』
  const isSignatureLine =
    typeof lastNonEmpty === "string" &&
    lastNonEmpty.trim().startsWith("— ") &&
    lastNonEmpty.includes("AI助理『") &&
    lastNonEmpty.trim().endsWith("』");

  if (!isSignatureLine) return message;

  // 移除最後一個非空白行（署名），保留前面的內容
  const kept = lines.slice(0, i).join("\n").replace(/[\r\n]+$/g, "");
  return kept;
}

/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:28:24.572Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Updated only comment annotations: fixed malformed/mismatched @external URL formats by converting FE-8004/FE-8007 shorthand to full Jira browse URLs, and ensured all declaration blocks use the required three-section layout wording and proper annotation styles without changing runtime logic.
 */

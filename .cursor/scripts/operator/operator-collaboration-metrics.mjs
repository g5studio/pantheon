#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module operator-collaboration-metrics
 * @purpose 彙整 Operator workflow 協作指標，供 Ares 分析 AI/人工協作狀況。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */

import { execSync } from "child_process";
import { getProjectRoot } from "../utilities/env-loader.mjs";

const VALID_USER_RESPONSE_TYPES = new Set([
  "directAgree",
  "requestChange",
  "question",
  "silentConfirm",
]);

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function normalizeIsoTime(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function readStartTaskNotesStartedAt() {
  const candidates = ["HEAD", "HEAD^"];

  try {
    candidates.push(exec("git merge-base HEAD main", { silent: true }).trim());
  } catch {
    // ignore
  }

  for (const ref of candidates) {
    try {
      const noteContent = exec(`git notes --ref=start-task show ${ref}`, {
        silent: true,
      }).trim();
      if (!noteContent) continue;
      const info = safeJsonParse(noteContent);
      if (!info || typeof info !== "object") continue;
      const startedAt = normalizeIsoTime(info.workflowStartedAt || info.startedAt);
      if (startedAt) return startedAt;
    } catch {
      // try next ref
    }
  }

  return null;
}

function exec(command, options = {}) {
  return execSync(command, {
    cwd: getProjectRoot(),
    encoding: "utf-8",
    stdio: options.silent ? "pipe" : "inherit",
    ...options,
  });
}

function parsePorcelainFiles(porcelain) {
  const files = new Set();
  for (const line of String(porcelain || "").split("\n")) {
    if (!line.trim()) continue;
    const path = line.slice(3).trim();
    if (path.includes(" -> ")) {
      files.add(path.split(" -> ").pop().trim());
    } else {
      files.add(path);
    }
  }
  return [...files].sort();
}

function parseNumstat(text) {
  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const add = parts[0] === "-" ? 0 : Number(parts[0]);
    const del = parts[1] === "-" ? 0 : Number(parts[1]);
    if (!Number.isFinite(add) || !Number.isFinite(del)) continue;
    files += 1;
    additions += add;
    deletions += del;
  }

  return { files, additions, deletions };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 擷取目前 git 工作區快照。
 * @purpose workflow 起點/終點比對，推斷人工改碼。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function captureGitSnapshot() {
  let headCommit = null;
  let porcelain = "";
  let workingNumstat = { files: 0, additions: 0, deletions: 0 };
  let stagedNumstat = { files: 0, additions: 0, deletions: 0 };

  try {
    headCommit = exec("git rev-parse HEAD", { silent: true }).trim();
  } catch {
    // not a git repo or no commits
  }

  try {
    porcelain = exec("git status --porcelain", { silent: true });
  } catch {
    // ignore
  }

  try {
    workingNumstat = parseNumstat(exec("git diff --numstat", { silent: true }));
  } catch {
    // ignore
  }

  try {
    stagedNumstat = parseNumstat(exec("git diff --cached --numstat", { silent: true }));
  } catch {
    // ignore
  }

  return {
    capturedAt: new Date().toISOString(),
    headCommit,
    dirtyFiles: parsePorcelainFiles(porcelain),
    uncommitted: {
      files: workingNumstat.files + stagedNumstat.files,
      additions: workingNumstat.additions + stagedNumstat.additions,
      deletions: workingNumstat.deletions + stagedNumstat.deletions,
    },
  };
}

function countCommitsSince(startHeadCommit) {
  if (!startHeadCommit) return 0;
  try {
    const currentHead = exec("git rev-parse HEAD", { silent: true }).trim();
    if (startHeadCommit === currentHead) return 0;
    const count = exec(`git rev-list --count ${startHeadCommit}..HEAD`, {
      silent: true,
    }).trim();
    return Number(count) || 0;
  } catch {
    return 0;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 比對起點/終點 git 快照，產生 humanEditSignals。
 * @purpose 支援 Ares 分析人工介入程度。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function computeHumanEditSignals(startSnapshot, endSnapshot) {
  const start = startSnapshot || {};
  const end = endSnapshot || captureGitSnapshot();

  const startDirty = new Set(start.dirtyFiles || []);
  const endDirty = new Set(end.dirtyFiles || []);
  const newDirtyFiles = [...endDirty].filter((file) => !startDirty.has(file));
  const commitsDuringSession = countCommitsSince(start.headCommit);

  const startUncommitted = start.uncommitted || { files: 0, additions: 0, deletions: 0 };
  const endUncommitted = end.uncommitted || { files: 0, additions: 0, deletions: 0 };

  const uncommittedDelta = {
    files: Math.max(0, endUncommitted.files - startUncommitted.files),
    additions: Math.max(0, endUncommitted.additions - startUncommitted.additions),
    deletions: Math.max(0, endUncommitted.deletions - startUncommitted.deletions),
  };

  const headChanged = Boolean(
    start.headCommit && end.headCommit && start.headCommit !== end.headCommit,
  );

  const humanEditDetected =
    commitsDuringSession > 0 ||
    headChanged ||
    newDirtyFiles.length > 0 ||
    uncommittedDelta.additions + uncommittedDelta.deletions > 0;

  return {
    humanEditDetected,
    commitsDuringSession,
    headChanged,
    filesChangedDuringSession: Math.max(newDirtyFiles.length, uncommittedDelta.files),
    linesAdded: uncommittedDelta.additions,
    linesRemoved: uncommittedDelta.deletions,
    newDirtyFiles,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 正規化文字供相似度計算。
 * @purpose fix-comment 多輪 reply 語意比對（Jaccard）。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function normalizeTextForSimilarity(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 計算兩段文字的 Jaccard 相似度（0~1）。
 * @purpose 偵測 fix-comment 卡迴圈。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function jaccardSimilarity(textA, textB) {
  const setA = new Set(normalizeTextForSimilarity(textA));
  const setB = new Set(normalizeTextForSimilarity(textB));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依 reply 文字序列計算連續相似度。
 * @purpose 產出 fixCommentMetrics。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function computeReplySimilarityMetrics(replies = []) {
  const texts = replies
    .map((item) => (typeof item === "string" ? item : item?.text))
    .filter((text) => typeof text === "string" && text.trim());

  const pairwiseScores = [];
  for (let i = 1; i < texts.length; i += 1) {
    pairwiseScores.push(Number(jaccardSimilarity(texts[i - 1], texts[i]).toFixed(4)));
  }

  return {
    rounds: texts.length,
    replySimilarityScores: pairwiseScores,
    replySimilarityMax:
      pairwiseScores.length > 0 ? Math.max(...pairwiseScores) : 0,
  };
}

function aggregateUserResponses(events = []) {
  const counts = {
    directAgree: 0,
    requestChange: 0,
    question: 0,
    silentConfirm: 0,
  };

  for (const event of events) {
    if (event?.type !== "user-response") continue;
    const responseType = event.responseType;
    if (VALID_USER_RESPONSE_TYPES.has(responseType)) {
      counts[responseType] += 1;
    }
  }

  return counts;
}

function aggregatePlanMetrics(events = [], session = {}) {
  const planEvents = events.filter((event) =>
    ["plan-initial", "plan-revision"].includes(event?.type),
  );

  const initialPlanEvent = planEvents.find((event) => event.type === "plan-initial");
  const revisionCount = planEvents.filter((event) => event.type === "plan-revision").length;

  return {
    initialPlanAt:
      initialPlanEvent?.occurredAt ||
      session.planMetrics?.initialPlanAt ||
      null,
    revisionCount,
    confirmedAt: session.planMetrics?.confirmedAt || null,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 start-task git notes 的 aiCompleted。
 * @purpose 合併進 collaborationMetrics。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function readStartTaskAiCompleted() {
  const candidates = ["HEAD", "HEAD^"];

  try {
    candidates.push(exec("git merge-base HEAD main", { silent: true }).trim());
  } catch {
    // ignore
  }

  for (const ref of candidates) {
    try {
      const noteContent = exec(`git notes --ref=start-task show ${ref}`, {
        silent: true,
      }).trim();
      if (!noteContent) continue;
      const info = safeJsonParse(noteContent);
      if (!info || typeof info !== "object") continue;
      if (typeof info.aiCompleted === "boolean") return info.aiCompleted;
    } catch {
      // try next
    }
  }

  return null;
}

function resolveCollaborationOutcome({ aiCompleted, humanEditDetected, status }) {
  if (humanEditDetected && aiCompleted === false) return "human-primary";
  if (!humanEditDetected && aiCompleted === true) return "ai-only";
  if (humanEditDetected && aiCompleted === true) return "mixed";
  if (humanEditDetected && status === "cancelled") return "human-primary";
  if (humanEditDetected) return "mixed";
  if (aiCompleted === false) return "human-primary";
  return "ai-only";
}

function resolveAbandonedAiCollaboration({
  humanEditDetected,
  aiCompleted,
  status,
  sessionResumeCount,
}) {
  if (!humanEditDetected) return false;
  if (aiCompleted === false) return true;
  if (status === "cancelled" && sessionResumeCount === 0) return true;
  return false;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依 session 事件與 git 快照彙整 collaborationMetrics。
 * @purpose send-operator-log 自動 merge 進 Ares payload。
 * @external https://innotech.atlassian.net/browse/FE-8517
 */
export function buildCollaborationMetrics(session, options = {}) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const startSnapshot = session?.gitSnapshotStart || null;
  const endSnapshot = session?.gitSnapshotEnd || captureGitSnapshot();

  const humanEditSignals = computeHumanEditSignals(startSnapshot, endSnapshot);
  const userResponses = aggregateUserResponses(events);
  const planMetrics = aggregatePlanMetrics(events, session);

  const replyTexts = events
    .filter((event) => event?.type === "fix-comment-reply")
    .map((event) => event.text);
  const fixCommentMetrics = computeReplySimilarityMetrics(replyTexts);

  const sessionResumeCount = events.filter((event) => event.type === "session-resume").length;

  let aiCompleted = session?.aiCompleted;
  if (typeof aiCompleted !== "boolean" && options.action === "start-task") {
    const fromNotes = readStartTaskAiCompleted();
    aiCompleted = typeof fromNotes === "boolean" ? fromNotes : true;
  }
  if (typeof aiCompleted !== "boolean") {
    aiCompleted = humanEditSignals.humanEditDetected ? null : true;
  }

  const status = options.status || "success";
  const collaborationOutcome = resolveCollaborationOutcome({
    aiCompleted,
    humanEditDetected: humanEditSignals.humanEditDetected,
    status,
  });

  const abandonedAiCollaboration = resolveAbandonedAiCollaboration({
    humanEditDetected: humanEditSignals.humanEditDetected,
    aiCompleted,
    status,
    sessionResumeCount,
  });

  const workflowStartedAt =
    session?.workflowStartedAt || readStartTaskNotesStartedAt() || null;

  return {
    workflowStartedAt,
    aiCompleted,
    humanEditDetected: humanEditSignals.humanEditDetected,
    humanEditSignals,
    collaborationOutcome,
    abandonedAiCollaboration,
    userResponses,
    planMetrics,
    fixCommentMetrics,
    sessionResumeCount,
    eventCount: events.length,
  };
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-07-06T00:00:00.000Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 新增 collaborationMetrics 彙整；git 快照與 Jaccard reply 相似度。
 */

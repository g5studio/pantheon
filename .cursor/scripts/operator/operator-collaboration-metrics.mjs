#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module operator-collaboration-metrics
 * @purpose 彙整 Operator workflow 協作指標，供 Ares 分析 AI/人工協作狀況。
 * @external https://innotech.atlassian.net/browse/OL-53
 */

import { execSync } from "child_process";
import { getProjectRoot, loadEnvLocal } from "../utilities/env-loader.mjs";
import { callLlmJson } from "../client/llm-client.mjs";

const VALID_USER_RESPONSE_TYPES = new Set([
  "directAgree",
  "requestChange",
  "question",
  "silentConfirm",
]);

/** agent-commit 慣用 subject：type(TICKET): lowercase message */
const AGENT_COMMIT_SUBJECT_RE =
  /^(feat|fix|update|refactor|chore|test|style|revert)\([A-Z][A-Z0-9]+-\d+\):\s+[a-z]/

const DIRECTION_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    humanDirectionAdjusted: { type: "boolean" },
    reason: { type: "string" },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
  required: ["humanDirectionAdjusted", "reason", "confidence"],
  additionalProperties: false,
};

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
 * @external https://innotech.atlassian.net/browse/OL-53
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
 * @description 判斷 commit subject 是否符合 agent-commit 慣用格式。
 * @purpose 排除 AI agent-commit 造成的 HEAD 變動誤判。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function isLikelyAgentCommitSubject(subject) {
  return AGENT_COMMIT_SUBJECT_RE.test(String(subject || "").trim());
}

function listCommitSubjectsSince(startHeadCommit) {
  if (!startHeadCommit) return [];
  try {
    const currentHead = exec("git rev-parse HEAD", { silent: true }).trim();
    if (startHeadCommit === currentHead) return [];
    const raw = exec(`git log --format=%s ${startHeadCommit}..HEAD`, {
      silent: true,
    });
    return String(raw || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 比對起點/終點 git 快照，產生 humanEditSignals。
 * @purpose OL-53：人工改碼以 dirty／uncommitted 為主；不單獨用 commit／HEAD 判定。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function computeHumanEditSignals(startSnapshot, endSnapshot) {
  const start = startSnapshot || {};
  const end = endSnapshot || captureGitSnapshot();

  const startDirty = new Set(start.dirtyFiles || []);
  const endDirty = new Set(end.dirtyFiles || []);
  const newDirtyFiles = [...endDirty].filter((file) => !startDirty.has(file));
  const commitsDuringSession = countCommitsSince(start.headCommit);
  const commitSubjects = listCommitSubjectsSince(start.headCommit);
  const agentCommitCount = commitSubjects.filter((subject) =>
    isLikelyAgentCommitSubject(subject),
  ).length;
  const nonAgentCommitCount = Math.max(0, commitSubjects.length - agentCommitCount);

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

  const dirtyHumanEdit =
    newDirtyFiles.length > 0 ||
    uncommittedDelta.additions + uncommittedDelta.deletions > 0;

  // OL-53: 不以 commitsDuringSession／headChanged 單獨判定；AI agent-commit 不計入手改。
  // 僅當存在非 agent-commit 的 commit 時，才把「已提交的手改」計入。
  const humanEditDetected = dirtyHumanEdit || nonAgentCommitCount > 0;

  return {
    humanEditDetected,
    commitsDuringSession,
    headChanged,
    agentCommitCount,
    nonAgentCommitCount,
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

function aggregatePlanMetrics(events = [], session = {}, options = {}) {
  const planEvents = events.filter((event) =>
    ["plan-initial", "plan-revision"].includes(event?.type),
  );

  const initialPlanEvent = planEvents.find((event) => event.type === "plan-initial");
  const revisionCount = planEvents.filter((event) => event.type === "plan-revision").length;
  const hasPlanSignal =
    planEvents.length > 0 || Boolean(session.planMetrics?.initialPlanAt);
  const missing =
    String(options.action || "").trim() === "start-task" && !hasPlanSignal;

  return {
    initialPlanAt:
      initialPlanEvent?.occurredAt ||
      session.planMetrics?.initialPlanAt ||
      null,
    revisionCount,
    confirmedAt: session.planMetrics?.confirmedAt || null,
    missing,
  };
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從 session events 收集本輪 user prompt 文字。
 * @purpose 供 LLM 判定人為調整方向（非 hardcode 事件類型）。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function collectSessionPromptTexts(session) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const prompts = [];

  for (const event of events) {
    if (event?.type !== "user-prompt") continue;
    const text = String(event.text || "").trim();
    if (text) prompts.push(text);
  }

  return prompts;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 以 LLM 分析 session prompt，判定是否人為調整方向。
 * @purpose OL-53：不得 hardcode plan-revision／requestChange；不得用 prompt 肯定手改。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export async function analyzeHumanDirectionAdjusted(prompts = [], options = {}) {
  const texts = (Array.isArray(prompts) ? prompts : [])
    .map((text) => String(text || "").trim())
    .filter(Boolean);

  if (texts.length === 0) {
    return {
      humanDirectionAdjusted: false,
      reason: "no session prompt records",
      confidence: "low",
      directionSignalSource: "fallback",
    };
  }

  const system = [
    "You classify whether the USER adjusted the TASK DIRECTION in an operator coding workflow.",
    "humanDirectionAdjusted=true ONLY when the user changed plan, approach, requirements, scope, or rejected the proposed solution and asked for a different direction.",
    "humanDirectionAdjusted=false for pure confirm/skip/agree/ack, clarifying questions that do not change direction, and status-only replies.",
    "Do NOT decide human code edits. Prompt text must NEVER be used as the sole evidence that a human edited code.",
    "Return JSON only.",
  ].join(" ");

  const input = [
    "Session user prompts (chronological):",
    ...texts.map((text, index) => `${index + 1}. ${text.slice(0, 2000)}`),
  ].join("\n");

  try {
    const envLocal = options.envLocal || loadEnvLocal();
    // OL-53: luna 僅支援預設 temperature；勿傳 0（會 400）。由 llm-client 省略自訂值。
    const { result } = await callLlmJson({
      action: "operator-direction-analysis",
      envLocal,
      system,
      input,
      schema: DIRECTION_ANALYSIS_SCHEMA,
      schemaName: "human_direction_adjusted",
      defaultModel: "gpt-5.6-luna",
    });

    return {
      humanDirectionAdjusted: Boolean(result?.humanDirectionAdjusted),
      reason: String(result?.reason || "").trim() || "llm analysis",
      confidence: ["high", "medium", "low"].includes(result?.confidence)
        ? result.confidence
        : "low",
      directionSignalSource: "llm",
    };
  } catch (error) {
    return {
      humanDirectionAdjusted: false,
      reason: `llm fallback: ${error?.message || "unknown error"}`,
      confidence: "low",
      directionSignalSource: "fallback",
    };
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依人工改碼／改方向訊號決定 collaborationOutcome。
 * @purpose OL-53：無人工介入一律 ai-only；不拆 guided-ai；已移除 aiCompleted。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function resolveCollaborationOutcome({
  humanEditDetected,
  humanDirectionAdjusted,
  status,
}) {
  const humanIntervention = Boolean(humanEditDetected || humanDirectionAdjusted);
  if (!humanIntervention) return "ai-only";

  if (humanEditDetected && status === "cancelled") return "human-primary";
  if (humanEditDetected && !humanDirectionAdjusted) return "human-primary";
  return "mixed";
}

function resolveAbandonedAiCollaboration({
  humanEditDetected,
  humanDirectionAdjusted,
  status,
  sessionResumeCount,
}) {
  const humanIntervention = Boolean(humanEditDetected || humanDirectionAdjusted);
  if (!humanIntervention) return false;
  if (status === "cancelled" && sessionResumeCount === 0) return true;
  return false;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 依 session 事件與 git 快照彙整 collaborationMetrics（async：含 LLM 改方向判定）。
 * @purpose send-operator-log 自動 merge 進 Ares payload。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export async function buildCollaborationMetrics(session, options = {}) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const startSnapshot = session?.gitSnapshotStart || null;
  const endSnapshot = session?.gitSnapshotEnd || captureGitSnapshot();

  const humanEditSignals = computeHumanEditSignals(startSnapshot, endSnapshot);
  const userResponses = aggregateUserResponses(events);
  const planMetrics = aggregatePlanMetrics(events, session, options);

  const replyTexts = events
    .filter((event) => event?.type === "fix-comment-reply")
    .map((event) => event.text);
  const fixCommentMetrics = computeReplySimilarityMetrics(replyTexts);

  const sessionResumeCount = events.filter((event) => event.type === "session-resume").length;

  const prompts = collectSessionPromptTexts(session);
  const directionAnalysis = await analyzeHumanDirectionAdjusted(prompts, options);
  const humanDirectionAdjusted = Boolean(directionAnalysis.humanDirectionAdjusted);

  const status = options.status || "success";
  const collaborationOutcome = resolveCollaborationOutcome({
    humanEditDetected: humanEditSignals.humanEditDetected,
    humanDirectionAdjusted,
    status,
  });

  const abandonedAiCollaboration = resolveAbandonedAiCollaboration({
    humanEditDetected: humanEditSignals.humanEditDetected,
    humanDirectionAdjusted,
    status,
    sessionResumeCount,
  });

  const workflowStartedAt =
    session?.workflowStartedAt || readStartTaskNotesStartedAt() || null;

  return {
    workflowStartedAt,
    humanEditDetected: humanEditSignals.humanEditDetected,
    humanEditSignals,
    humanDirectionAdjusted,
    directionSignals: {
      humanDirectionAdjusted,
      reason: directionAnalysis.reason,
      confidence: directionAnalysis.confidence,
      source: directionAnalysis.directionSignalSource,
      promptCount: prompts.length,
    },
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
 * @llm-review-submitted-at 2026-07-20T17:35:00.000Z
 * @llm-review-model cursor-grok
 * @llm-review-note OL-53：移除方向分析 temperature:0；改由 llm-client 對 luna 省略自訂 temperature。
 */

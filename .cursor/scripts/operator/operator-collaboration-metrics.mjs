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

/**
 * 宣告內容用途說明與單號關聯
 * @description 判斷 start commit 是否為 end HEAD 的祖先。
 * @purpose 切 release／換歷史線時 A..B 會膨脹，此時 commit 訊號不可信。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function isCommitAncestorOfHead(startHeadCommit, endHeadCommit) {
  const start = String(startHeadCommit || "").trim();
  const end = String(endHeadCommit || "").trim();
  if (!start || !end) return false;
  if (start === end) return true;
  try {
    exec(`git merge-base --is-ancestor ${start} ${end}`, { silent: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 列出 start..end 的 commit（含 sha／committer 時間／subject）。
 * @purpose 供 session 時間窗過濾；不再用 subject 格式判斷 agent。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function listCommitsBetween(startHeadCommit, endHeadCommit) {
  const start = String(startHeadCommit || "").trim();
  const end = String(endHeadCommit || "").trim();
  if (!start || !end || start === end) return [];
  try {
    const raw = exec(`git log --format=%H%x09%ct%x09%s ${start}..${end}`, {
      silent: true,
    });
    return String(raw || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, ct, ...subjectParts] = line.split("\t");
        return {
          sha: String(sha || "").trim(),
          committerTs: Number(ct) || 0,
          subject: subjectParts.join("\t").trim(),
        };
      })
      .filter((item) => item.sha);
  } catch {
    return [];
  }
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 從 session events 收集 type=agent-commit 的 SHA。
 * @purpose 以 operator session 紀錄辨識 AI commit，不用 conventional subject 格式。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function collectAgentCommitShas(session) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const shas = new Set();
  for (const event of events) {
    if (event?.type !== "agent-commit") continue;
    const sha = String(event.sha || "").trim().toLowerCase();
    if (sha) shas.add(sha);
  }
  return shas;
}

/**
 * 宣告內容用途說明與單號關聯
 * @description 比對起點/終點 git 快照，產生 humanEditSignals。
 * @purpose OL-53：dirty 為主；commit 需祖先可信 + session 時間窗；agent 以 session SHA 辨識。
 * @external https://innotech.atlassian.net/browse/OL-53
 */
export function computeHumanEditSignals(startSnapshot, endSnapshot, options = {}) {
  const start = startSnapshot || {};
  const end = endSnapshot || captureGitSnapshot();
  const sessionStartedAtMs = Date.parse(
    String(options.sessionStartedAt || start.capturedAt || ""),
  );
  const hasSessionStart = Number.isFinite(sessionStartedAtMs);
  const agentCommitShas =
    options.agentCommitShas instanceof Set
      ? options.agentCommitShas
      : new Set(
          Array.isArray(options.agentCommitShas)
            ? options.agentCommitShas.map((sha) => String(sha || "").trim().toLowerCase())
            : [],
        );

  const startDirty = new Set(start.dirtyFiles || []);
  const endDirty = new Set(end.dirtyFiles || []);
  const newDirtyFiles = [...endDirty].filter((file) => !startDirty.has(file));

  const commitRangeReliable = isCommitAncestorOfHead(start.headCommit, end.headCommit);
  const rawCommits = commitRangeReliable
    ? listCommitsBetween(start.headCommit, end.headCommit)
    : [];
  const sessionCommits = hasSessionStart
    ? rawCommits.filter((commit) => commit.committerTs * 1000 >= sessionStartedAtMs)
    : [];

  // OL-53: 不用 subject 格式判斷 agent（人與 AI 都可能用 type(TICKET): msg）。
  // 僅採信 operator session 的 agent-commit 事件 SHA；無紀錄時不把 commit 當手改。
  const agentCommitAttribution = agentCommitShas.size > 0 ? "session-events" : "unavailable";
  const agentCommitCount = sessionCommits.filter((commit) =>
    agentCommitShas.has(commit.sha.toLowerCase()),
  ).length;
  const humanCommitCount =
    agentCommitAttribution === "session-events"
      ? sessionCommits.filter((commit) => !agentCommitShas.has(commit.sha.toLowerCase()))
          .length
      : 0;

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

  // 不以 commitsDuringSession／headChanged／subject 格式單獨判定。
  const humanEditDetected = dirtyHumanEdit || humanCommitCount > 0;

  return {
    humanEditDetected,
    commitsDuringSession: sessionCommits.length,
    commitsInRangeRaw: rawCommits.length,
    headChanged,
    commitRangeReliable,
    agentCommitAttribution,
    agentCommitCount,
    // 相容舊欄位：語意改為「session 時間窗內、且非 session agent-commit SHA」
    nonAgentCommitCount: humanCommitCount,
    humanCommitCount,
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

  const humanEditSignals = computeHumanEditSignals(startSnapshot, endSnapshot, {
    sessionStartedAt: session?.workflowStartedAt || startSnapshot?.capturedAt || null,
    agentCommitShas: collectAgentCommitShas(session),
  });
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
 * @llm-review-submitted-at 2026-07-30T19:30:00.000Z
 * @llm-review-model cursor-grok
 * @llm-review-note OL-92：commit 需祖先可信+時間窗；agent 改 session SHA；停用 subject 格式判定。
 */

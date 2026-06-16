#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module external-output
 * @purpose Agent-first 外部腳本輸出標準：format、截斷、meta hints、stdout/stderr 分離
 * @external https://innotech.atlassian.net/browse/FE-8389
 */

/** @description 支援的輸出格式 @purpose CLI/agent 契約 @external https://innotech.atlassian.net/browse/FE-8389 */
export const OUTPUT_FORMAT = {
  AGENT: "agent",
  HUMAN: "human",
  JSON: "json",
};

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_COMMENTS_LIMIT = 20;
const DEFAULT_BODY_CHARS = 500;

/** @description 0=不取；all/-1=不設限；正整數=上限 @external https://innotech.atlassian.net/browse/FE-8389 */
export function resolveCommentsLimit(value) {
  if (value === "all" || value === -1 || value === Infinity) {
    return Infinity;
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return DEFAULT_COMMENTS_LIMIT;
}

/** @description 計算實際 slice 上限 @external https://innotech.atlassian.net/browse/FE-8389 */
export function sliceCommentsByLimit(comments, commentsLimit) {
  const limit = resolveCommentsLimit(commentsLimit);

  if (limit === 0) {
    return { comments: [], hasMoreComments: comments.length > 0 };
  }

  if (limit === Infinity) {
    return { comments: [...comments], hasMoreComments: false };
  }

  return {
    comments: comments.slice(0, limit),
    hasMoreComments: comments.length > limit,
  };
}

/**
 * @description 解析 --format= 與 TTY 推斷預設格式
 * @purpose agent 路徑預設 agent；互動終端預設 human
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function resolveOutputFormat(explicitFormat) {
  if (explicitFormat === OUTPUT_FORMAT.HUMAN) return OUTPUT_FORMAT.HUMAN;
  if (explicitFormat === OUTPUT_FORMAT.JSON) return OUTPUT_FORMAT.JSON;
  if (explicitFormat === OUTPUT_FORMAT.AGENT) return OUTPUT_FORMAT.AGENT;

  if (process.stdout.isTTY) {
    return OUTPUT_FORMAT.HUMAN;
  }

  return OUTPUT_FORMAT.AGENT;
}

/**
 * @description 解析共用 CLI 旗標
 * @purpose 供 Jira/GitLab read 腳本共用
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function parseExternalOutputArgs(argv) {
  const result = {
    positional: [],
    format: null,
    includeRaw: false,
    maxChars: DEFAULT_MAX_CHARS,
    commentsLimit: DEFAULT_COMMENTS_LIMIT,
    commentsLimitExplicit: false,
    commentsSince: null,
    skipSystemComments: false,
    section: "all",
    bundle: null,
    unresolvedOnly: false,
    maxBodyChars: DEFAULT_BODY_CHARS,
    maxNotesPerDiscussion: null,
    verbose: false,
    help: false,
    ticket: null,
    url: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
      const value =
        eqIndex >= 0 ? arg.slice(eqIndex + 1) : argv[++i] ?? true;

      switch (key) {
        case "format":
          result.format = String(value);
          break;
        case "include-raw":
          result.includeRaw = value === true || value === "true";
          break;
        case "max-chars":
          result.maxChars = Number(value);
          break;
        case "comments-limit":
          result.commentsLimit = resolveCommentsLimit(value);
          result.commentsLimitExplicit = true;
          break;
        case "comments-since":
          result.commentsSince = String(value);
          break;
        case "skip-system-comments":
          result.skipSystemComments =
            value === true || value === "true" || value === undefined;
          break;
        case "section":
          result.section = String(value);
          break;
        case "bundle":
          result.bundle = String(value);
          break;
        case "unresolved-only":
          result.unresolvedOnly =
            value === true || value === "true" || value === undefined;
          break;
        case "max-body-chars":
          result.maxBodyChars = Number(value);
          break;
        case "max-notes-per-discussion":
          result.maxNotesPerDiscussion = Number(value);
          break;
        case "verbose":
          result.verbose = value === true || value === "true";
          break;
        case "ticket":
          result.ticket = String(value);
          break;
        default:
          result[key.replace(/-/g, "_")] = value;
          break;
      }
      continue;
    }

    if (arg === "--") continue;
    result.positional.push(arg);
  }

  result.resolvedFormat = resolveOutputFormat(result.format);
  return result;
}

/**
 * @description 依 bundle 套用 section 與 limit 預設
 * @purpose start-task / cr / rd-context 預設組合
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function applyBundleDefaults(options) {
  if (!options.bundle) return options;

  const next = { ...options, bundleApplied: options.bundle };

  switch (options.bundle) {
    case "start-task":
      next.section = "all";
      if (!options.commentsLimitExplicit) {
        next.commentsLimit = Infinity;
      }
      break;
    case "cr":
      next.section = "metadata";
      if (!options.commentsLimitExplicit) {
        next.commentsLimit = 0;
      }
      break;
    case "rd-context":
      next.section = "comments";
      if (!options.commentsLimitExplicit) {
        next.commentsLimit = Infinity;
      }
      break;
    default:
      break;
  }

  return next;
}

/**
 * @description 截斷文字並回傳 meta
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function truncateText(text, maxChars) {
  const value = String(text ?? "");
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : value.length;

  if (value.length <= limit) {
    return {
      text: value,
      truncated: false,
      totalChars: value.length,
      returnedChars: value.length,
    };
  }

  return {
    text: `${value.slice(0, limit)}…`,
    truncated: true,
    totalChars: value.length,
    returnedChars: limit,
  };
}

/**
 * @description 合併截斷 meta 與 hints
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function buildMeta(partial = {}) {
  const meta = { truncated: false, hints: {}, ...partial };

  if (!meta.hints || typeof meta.hints !== "object") {
    meta.hints = {};
  }

  const nextSections = [];
  if (meta.hasMoreComments) nextSections.push("comments");
  if (meta.hasMoreDescription) nextSections.push("description");
  if (meta.hasMoreLinks) nextSections.push("links");
  if (nextSections.length > 0) {
    meta.hints.nextSections = nextSections;
  }

  if (meta.hasRdNotes) {
    meta.hints.hasRdNotes = true;
  }

  return meta;
}

/**
 * @description 保守判斷 bot / 系統留言
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function isSystemComment(comment) {
  const author = String(comment?.author ?? "").toLowerCase();
  const body = String(comment?.body ?? "").trim();

  if (!body || body === "." || body === "..") return true;

  const botPatterns = [
    /^automation for jira/i,
    /^jira automation/i,
    /^gitlab/i,
    /\[bot\]/i,
    /^ai review submitted/i,
    /^🤖 agent version/i,
  ];

  return botPatterns.some((pattern) => pattern.test(body) || pattern.test(author));
}

/**
 * @description 偵測 RD 相關關鍵字
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function commentLooksLikeRdNote(body) {
  const text = String(body ?? "");
  return /(RD|請|建議|注意|must|should|fix|review|確認|方向|方案)/i.test(text);
}

/**
 * @description 進度與 debug 訊息走 stderr
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function logProgress(...args) {
  console.error(...args);
}

/**
 * @description 錯誤輸出（stderr）並結束程序
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function writeScriptError(error, code = "EXTERNAL_SCRIPT_ERROR") {
  const payload = {
    ok: false,
    error: typeof error === "string" ? error : error?.message ?? String(error),
    code,
  };
  console.error(JSON.stringify(payload));
  process.exit(1);
}

/**
 * @description 將結果寫入 stdout
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function writeScriptResult(result, format) {
  const resolved = resolveOutputFormat(format);

  if (resolved === OUTPUT_FORMAT.HUMAN) {
    console.log(formatHumanResult(result));
    return;
  }

  const payload = resolved === OUTPUT_FORMAT.AGENT ? { ok: true, ...result } : result;
  const space = resolved === OUTPUT_FORMAT.JSON ? 2 : 0;
  console.log(JSON.stringify(payload, null, space));
}

function formatHumanResult(result) {
  if (typeof result.message === "string") {
    return result.message;
  }
  return JSON.stringify(result, null, 2);
}

/**
 * @description 依 section 過濾 Jira agent payload
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function pickJiraSections(payload, section) {
  if (!section || section === "all") return payload;

  const base = {
    ok: true,
    source: "jira",
    ticket: payload.ticket,
    url: payload.url,
    meta: payload.meta,
  };

  switch (section) {
    case "summary":
      return {
        ...base,
        summary: payload.summary,
        issueType: payload.issueType,
        status: payload.status,
      };
    case "description":
      return { ...base, description: payload.description };
    case "comments":
      return { ...base, comments: payload.comments };
    case "links":
      return { ...base, links: payload.links, subtasks: payload.subtasks };
    case "metadata":
      return {
        ...base,
        summary: payload.summary,
        issueType: payload.issueType,
        status: payload.status,
        assignee: payload.assignee,
        priority: payload.priority,
        labels: payload.labels,
        components: payload.components,
        fixVersions: payload.fixVersions,
        dueDate: payload.dueDate,
        subtasks: payload.subtasks,
      };
    default:
      return payload;
  }
}

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-14T12:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note 新增 FE-8389 Agent-first 外部腳本輸出共用 utility。
 */

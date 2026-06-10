#!/usr/bin/env node

/**
 * Jira 內容格式檢查與正規化
 *
 * 在呼叫 Jira API 前，將 chat 常見的 Markdown 內容轉為 Jira 可正確呈現的格式。
 * 優先使用 LLM 做語意保留的格式轉換；失敗時 fallback 到 heuristic 規則。
 */

import { loadEnvLocal, getCompassApiToken } from "../utilities/env-loader.mjs";
import { callOpenAiJson, resolveLlmModel } from "../utilities/llm-client.mjs";

export const JIRA_CONTENT_OPERATIONS = {
  COMMENT: "comment",
  DESCRIPTION: "description",
  SUMMARY: "summary",
};

const MARKDOWN_PATTERNS = [
  { name: "hasMarkdownHeadings", regex: /^#{1,6}\s+/m },
  { name: "hasMarkdownBold", regex: /\*\*[^*\n]+\*\*/ },
  { name: "hasMarkdownItalic", regex: /(?<!\*)\*[^*\n]+\*(?!\*)/ },
  { name: "hasMarkdownLinks", regex: /\[[^\]]+\]\([^)]+\)/ },
  { name: "hasMarkdownBullets", regex: /^\s*[-*+]\s+/m },
  { name: "hasMarkdownOrderedList", regex: /^\s*\d+\.\s+/m },
  { name: "hasMarkdownCodeFence", regex: /```(?!mermaid)/ },
  { name: "hasMarkdownInlineCode", regex: /`[^`\n]+`/ },
  { name: "hasMarkdownBlockquote", regex: /^>\s+/m },
  { name: "hasMarkdownHorizontalRule", regex: /^---+$/m },
];

const FORMAT_SCHEMA = {
  type: "object",
  properties: {
    normalizedContent: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["converted", "removed", "preserved"],
          },
          detail: { type: "string" },
        },
        required: ["type", "detail"],
        additionalProperties: false,
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    detectedFormats: {
      type: "object",
      properties: {
        hasMermaid: { type: "boolean" },
        hasPipeTable: { type: "boolean" },
        hasMarkdownHeadings: { type: "boolean" },
        hasMarkdownBold: { type: "boolean" },
        hasMarkdownLinks: { type: "boolean" },
      },
      required: [
        "hasMermaid",
        "hasPipeTable",
        "hasMarkdownHeadings",
        "hasMarkdownBold",
        "hasMarkdownLinks",
      ],
      additionalProperties: false,
    },
  },
  required: ["normalizedContent", "changes", "warnings", "detectedFormats"],
  additionalProperties: false,
};

function detectPipeTable(text) {
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|")) continue;
    const separator = lines[i + 1].trim();
    if (
      /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator)
    ) {
      return true;
    }
  }
  return false;
}

function detectMermaidBlocks(text) {
  return /```mermaid\s*\n[\s\S]*?```/.test(String(text ?? ""));
}

/**
 * 偵測內容是否含 chat 常見 Markdown 特徵
 * @param {string} content
 * @returns {{ hasMarkdown: boolean, features: Record<string, boolean> }}
 */
export function detectMarkdownFeatures(content) {
  const text = String(content ?? "");
  const features = {
    hasMermaid: detectMermaidBlocks(text),
    hasPipeTable: detectPipeTable(text),
    hasMarkdownHeadings: false,
    hasMarkdownBold: false,
    hasMarkdownLinks: false,
    hasMarkdownItalic: false,
    hasMarkdownBullets: false,
    hasMarkdownOrderedList: false,
    hasMarkdownCodeFence: false,
    hasMarkdownInlineCode: false,
    hasMarkdownBlockquote: false,
    hasMarkdownHorizontalRule: false,
  };

  let hasMarkdown = features.hasMermaid || features.hasPipeTable;

  for (const { name, regex } of MARKDOWN_PATTERNS) {
    const found = regex.test(text);
    features[name] = found;
    if (found) hasMarkdown = true;
  }

  return { hasMarkdown, features };
}

/**
 * @param {Object} [options]
 * @returns {boolean}
 */
export function shouldSkipFormatCheck(options = {}) {
  if (options.skipFormatCheck) return true;
  const envFlag = String(process.env.JIRA_SKIP_FORMAT_CHECK || "").toLowerCase();
  return envFlag === "1" || envFlag === "true" || envFlag === "yes";
}

function buildOperationGuide(operation, options = {}) {
  if (operation === JIRA_CONTENT_OPERATIONS.SUMMARY) {
    return [
      "Target: Jira issue summary (plain single-line text).",
      "Remove all Markdown syntax.",
      "Collapse whitespace to a single line.",
      "Do not add prefixes like [AI] unless already present.",
    ].join("\n");
  }

  const lines = [
    "Target: Jira rich text that will be converted to ADF.",
    "Output plain text with paragraph breaks (blank lines between sections).",
    "Preserve semantic meaning; do not invent new facts.",
  ];

  if (operation === JIRA_CONTENT_OPERATIONS.COMMENT) {
    lines.push("This content will be posted as a Jira comment.");
  } else {
    lines.push("This content will be posted as a Jira issue description.");
  }

  lines.push(
    "Keep Markdown pipe tables EXACTLY as-is (| col | col | with separator row).",
    "Keep ```mermaid ... ``` blocks EXACTLY as-is when present.",
    "Preserve section headings as Markdown headings for ADF rendering.",
    "Use ## for main section titles and ### for subsections; KEEP the # prefix.",
    "If a standalone short line is clearly a section title without #, prefix it with ##.",
    "Convert **bold** and *italic* to plain text without markers.",
    "Convert [label](url) links to: label (url).",
    "Keep bullet lists as lines starting with - (no nested Markdown).",
    "Remove horizontal rules (---).",
    "Remove blockquote markers (>).",
    "For non-mermaid code fences, keep code body but remove fence markers."
  );

  if (options.renderFlowchart) {
    lines.push(
      "renderFlowchart is enabled: mermaid blocks MUST remain valid and unchanged."
    );
  }

  return lines.join("\n");
}

function heuristicNormalize(content, operation) {
  let text = String(content ?? "");
  const changes = [];

  if (operation === JIRA_CONTENT_OPERATIONS.SUMMARY) {
    text = text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();

    if (text !== String(content ?? "").trim()) {
      changes.push({
        type: "converted",
        detail: "heuristic: removed markdown from summary",
      });
    }

    return {
      normalizedContent: text,
      changes,
      warnings:
        changes.length > 0
          ? ["LLM 不可用，已使用 heuristic fallback 正規化 summary"]
          : [],
    };
  }

  const original = text;

  text = text.replace(/\*\*([^*]+)\*\*/g, (_, value) => {
    changes.push({
      type: "converted",
      detail: `removed bold markers: ${value}`,
    });
    return value;
  });

  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    changes.push({
      type: "converted",
      detail: `link -> text: ${label}`,
    });
    return `${label} (${url})`;
  });

  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/```(?!mermaid)(\w*)\n([\s\S]*?)```/g, (_, _lang, code) =>
    code.trim()
  );
  text = text.replace(/^>\s+/gm, "");
  text = text.replace(/^---+$/gm, "");

  const normalizedContent = text.trim();

  if (normalizedContent !== original.trim()) {
    changes.push({
      type: "converted",
      detail: "heuristic: normalized markdown-rich content for Jira ADF",
    });
  }

  return {
    normalizedContent,
    changes,
    warnings:
      changes.length > 0
        ? ["LLM 不可用，已使用 heuristic fallback 正規化內容"]
        : [],
  };
}

async function normalizeWithLlm(content, operation, options = {}) {
  const envLocal = loadEnvLocal();
  const model = resolveLlmModel({
    explicitModel: options.model,
    envLocal,
    envKeys: [
      "JIRA_FORMAT_LLM_MODEL",
      "LABEL_ANALYZER_LLM_MODEL",
      "OPENAI_MODEL",
    ],
    defaultModel: "gpt-5.4-nano",
  });

  const apiKey = process.env.OPENAI_API_KEY || envLocal.OPENAI_API_KEY || "";
  const customOpenAiApiUrl =
    process.env.CUSTOM_OPENAI_API_URL || envLocal.CUSTOM_OPENAI_API_URL || null;
  const compassApiToken = getCompassApiToken();
  const forceCompassProxy = !apiKey && !!compassApiToken;

  const system = [
    "You are a Jira content formatter.",
    "Convert agent/chat Markdown into Jira-safe plain text BEFORE ADF conversion.",
    "Return ONLY valid JSON matching the schema.",
    "",
    buildOperationGuide(operation, options),
    "",
    "Rules:",
    "- Do not wrap output in Markdown code fences.",
    "- Do not add commentary outside normalizedContent.",
    "- Preserve ticket IDs, URLs, file paths, and technical terms exactly.",
    "- If content is already Jira-safe, return it unchanged and mark as preserved.",
  ].join("\n");

  const input = {
    operation,
    renderFlowchart: Boolean(options.renderFlowchart),
    content,
  };

  const result = await callOpenAiJson({
    apiKey,
    customOpenAiApiUrl,
    compassApiToken,
    forceCompassProxy,
    model,
    system,
    input,
    temperature: 0.1,
    schema: FORMAT_SCHEMA,
    schemaName: "jira_content_format",
  });

  return {
    normalizedContent: String(result.normalizedContent ?? content),
    changes: Array.isArray(result.changes) ? result.changes : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    detectedFormats: result.detectedFormats || detectMarkdownFeatures(content).features,
    usedLlm: true,
    model,
  };
}

/**
 * 在呼叫 Jira API 前正規化文字內容
 * @param {string} content
 * @param {"comment"|"description"|"summary"} operation
 * @param {Object} [options]
 * @param {boolean} [options.skipFormatCheck=false]
 * @param {boolean} [options.renderFlowchart=false]
 * @param {string} [options.model]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<Object>}
 */
export async function prepareJiraContent(content, operation, options = {}) {
  const input = String(content ?? "");
  const { hasMarkdown, features } = detectMarkdownFeatures(input);

  if (shouldSkipFormatCheck(options)) {
    return {
      normalizedContent: input,
      skipped: true,
      fastPath: false,
      usedLlm: false,
      changes: [],
      warnings: [],
      detectedFormats: features,
    };
  }

  if (!hasMarkdown) {
    return {
      normalizedContent: input,
      skipped: false,
      fastPath: true,
      usedLlm: false,
      changes: [],
      warnings: [],
      detectedFormats: features,
    };
  }

  if (!options.silent) {
    console.error(
      `📝 偵測到 Markdown 格式，正在進行 Jira 內容格式檢查... (operation=${operation})`
    );
  }

  try {
    const llmResult = await normalizeWithLlm(input, operation, options);
    if (!options.silent && llmResult.changes?.length) {
      console.error(
        `✅ 格式檢查完成（LLM）：調整 ${llmResult.changes.length} 項`
      );
    }
    return {
      ...llmResult,
      skipped: false,
      fastPath: false,
    };
  } catch (error) {
    const fallback = heuristicNormalize(input, operation);
    if (!options.silent) {
      console.error(
        `⚠️ LLM 格式檢查失敗，改用 heuristic fallback: ${error.message}`
      );
    }
    return {
      ...fallback,
      skipped: false,
      fastPath: false,
      usedLlm: false,
      llmError: error.message,
      detectedFormats: features,
    };
  }
}

/**
 * 精簡 format check 結果，方便腳本 JSON 輸出
 * @param {Object} formatResult
 * @returns {Object|null}
 */
export function summarizeFormatCheck(formatResult) {
  if (!formatResult || formatResult.skipped) return null;

  return {
    fastPath: Boolean(formatResult.fastPath),
    usedLlm: Boolean(formatResult.usedLlm),
    model: formatResult.model || null,
    llmError: formatResult.llmError || null,
    changeCount: Array.isArray(formatResult.changes)
      ? formatResult.changes.length
      : 0,
    warnings: formatResult.warnings || [],
    detectedFormats: formatResult.detectedFormats || null,
  };
}

#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/jira/jira-adf-builder.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8310
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 中間區塊：宣告級註解用途說明與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本檔案主要導出用於產生 Jira ADF 的建構器；解析 heading、pipe table、bullet list，並可選擇支援 mermaid 渲染。
 * @purpose 銜接外層組裝 ADF doc/content 的通用流程
 * @external https://innotech.atlassian.net/browse/FE-8310
 */

import {
  renderMermaidToAdfNodes,
  splitCommentSegments,
} from "./mermaid-flowchart.mjs";

function normalizePipeRowCells(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed.includes("|")) return null;

  const parts = trimmed.split("|").map((s) => s.trim());
  if (parts.length > 0 && parts[0] === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();

  if (parts.length === 0) return null;
  return parts;
}

function isMarkdownTableSeparatorLine(line, expectedCols) {
  const cells = normalizePipeRowCells(line);
  if (!cells) return false;
  if (typeof expectedCols === "number" && cells.length !== expectedCols) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function makeAdfTextParagraph(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { type: "paragraph", content: [] };
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: trimmed }],
  };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 解析 Markdown heading 行（例如：# 標題），回傳 level 與文字。
 * @purpose 銜接 ADF heading 節點產生流程。
 * @external https://innotech.atlassian.net/browse/FE-8310
 * @param {string} line
 * @returns {{ level: number, text: string } | null}
 */
export function parseMarkdownHeadingLine(line) {
  const match = String(line ?? "")
    .trim()
    .match(/^(#{1,6})\s+(.+)$/);
  if (!match) return null;

  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

function makeAdfHeading(level, text) {
  return {
    type: "heading",
    attrs: {
      level: Math.min(Math.max(level, 1), 6),
    },
    content: [{ type: "text", text }],
  };
}

function makeAdfBulletList(items) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [makeAdfTextParagraph(item)],
    })),
  };
}

function isBulletLine(line) {
  return /^\s*[-*+]\s+/.test(line ?? "");
}

function stripBulletMarker(line) {
  return String(line ?? "")
    .replace(/^\s*[-*+]\s+/, "")
    .trim();
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 將 Markdown pipe table 區段轉為 Jira ADF table 結構。
 * @purpose 用於段落解析時偵測表格格式並產出對應 ADF nodes。
 * @external https://innotech.atlassian.net/browse/FE-8310
 * @param {string} paragraph
 * @returns {{ type: string, content: any[] } | null}
 */
export function markdownPipeTableToADF(paragraph) {
  const lines = (paragraph ?? "")
    .split(/\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return null;

  const headerCells = normalizePipeRowCells(lines[0]);
  if (!headerCells) return null;

  if (!isMarkdownTableSeparatorLine(lines[1], headerCells.length)) return null;

  const bodyRowCells = [];
  for (let i = 2; i < lines.length; i++) {
    const row = normalizePipeRowCells(lines[i]);
    if (!row) return null;
    bodyRowCells.push(row);
  }

  const colCount = headerCells.length;

  const headerRow = {
    type: "tableRow",
    content: headerCells.map((cell) => ({
      type: "tableHeader",
      content: [makeAdfTextParagraph(cell)],
    })),
  };

  const rows = bodyRowCells.map((cells) => {
    const normalized = cells.slice(0, colCount);
    while (normalized.length < colCount) normalized.push("");

    return {
      type: "tableRow",
      content: normalized.map((cell) => ({
        type: "tableCell",
        content: [makeAdfTextParagraph(cell)],
      })),
    };
  });

  return {
    type: "table",
    content: [headerRow, ...rows],
  };
}

function paragraphToAdfNodes(paragraph) {
  const tableNode = markdownPipeTableToADF(paragraph);
  if (tableNode) {
    return [tableNode];
  }

  const trimmedParagraph = (paragraph ?? "").trim();
  if (!trimmedParagraph) {
    return [];
  }

  const lines = trimmedParagraph
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const nodes = [];
  let bulletBuffer = [];

  const flushBulletBuffer = () => {
    if (bulletBuffer.length === 0) return;
    nodes.push(makeAdfBulletList(bulletBuffer));
    bulletBuffer = [];
  };

  for (const line of lines) {
    const heading = parseMarkdownHeadingLine(line);
    if (heading) {
      flushBulletBuffer();
      nodes.push(makeAdfHeading(heading.level, heading.text));
      continue;
    }

    if (isBulletLine(line)) {
      bulletBuffer.push(stripBulletMarker(line));
      continue;
    }

    flushBulletBuffer();
    nodes.push(makeAdfTextParagraph(line.trim()));
  }

  flushBulletBuffer();
  return nodes;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 將文字區段拆分成多個段落，並逐段產出 ADF content nodes（支援 heading、pipe table、bullet list）。
 * @purpose 提供給外層組裝 ADF doc/content。
 * @external https://innotech.atlassian.net/browse/FE-8310
 * @param {string} text
 * @returns {Object[]}
 */
export function buildTextSegmentAdfNodes(text) {
  const paragraphs = (text ?? "").split(/\n\n+/);
  const nodes = [];

  paragraphs.forEach((paragraph) => {
    nodes.push(...paragraphToAdfNodes(paragraph));
  });

  return nodes;
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 將純文字轉為完整 ADF doc（同步，不含 mermaid 渲染）。
 * @purpose 提供無 mermaid 時的 ADF doc 組裝。
 * @external https://innotech.atlassian.net/browse/FE-8310
 * @param {string} text
 * @returns {Object}
 */
export function buildAdfDocFromText(text) {
  return {
    version: 1,
    type: "doc",
    content: buildTextSegmentAdfNodes(text),
  };
}

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 將富文字轉為 ADF（可選 mermaid 渲染）。
 * @purpose 在需要時將 mermaid segment 以 ADF nodes 與對應 flowcharts 結合。
 * @external https://innotech.atlassian.net/browse/FE-8310
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.renderFlowchart=false]
 * @returns {Promise<{ doc: Object, flowcharts: Object[] }>}
 */
export async function buildRichTextAdf(text, options = {}) {
  const renderFlowchart = Boolean(options.renderFlowchart);

  if (!renderFlowchart) {
    return {
      doc: buildAdfDocFromText(text),
      flowcharts: [],
    };
  }

  const segments = splitCommentSegments(text);
  const content = [];
  const flowcharts = [];
  let flowchartIndex = 0;

  for (const segment of segments) {
    if (segment.type === "text") {
      content.push(...buildTextSegmentAdfNodes(segment.content));
      continue;
    }

    flowchartIndex += 1;
    const rendered = await renderMermaidToAdfNodes(
      segment.content,
      flowchartIndex
    );

    content.push(...rendered.nodes);
    flowcharts.push({
      index: flowchartIndex,
      imageUrl: rendered.imageUrl,
      fallback: rendered.fallback,
      warning: rendered.warning || null,
    });
  }

  return {
    doc: {
      version: 1,
      type: "doc",
      content,
    },
    flowcharts,
  };
}

/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:22:34.970Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 調整並統一檔案註解為三段式版面；修正中間宣告區塊標題與 @external URL 取值為完整 Jira browse 格式；保留程式邏輯不變並移除重複/不符合格式的 llm 分析區註解。
 */

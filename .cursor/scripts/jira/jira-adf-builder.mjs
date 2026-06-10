#!/usr/bin/env node

/**
 * Jira ADF 共用建構器
 *
 * 將純文字 / Markdown pipe table 轉為 Jira ADF。
 * 供 add-jira-comment、create-jira-ticket、update-jira 共用。
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
 * 將純文字區段轉為 ADF content nodes（支援 heading、pipe table、bullet list）
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
 * 將純文字轉為完整 ADF doc（同步，不含 mermaid 渲染）
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
 * 將富文字轉為 ADF（可選 mermaid 渲染）
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

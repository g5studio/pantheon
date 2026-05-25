#!/usr/bin/env node

/**
 * Mermaid 流程圖渲染工具（供 Jira 留言使用）
 *
 * 將 Mermaid 原始碼轉為 mermaid.ink 公開圖片 URL，
 * 再透過 ADF external media 節點嵌入 Jira comment。
 */

const MERMAID_FENCE_REGEX = /```mermaid\s*\n([\s\S]*?)```/g;

/**
 * 解析留言中的 Mermaid fenced code blocks
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'mermaid', content: string }>}
 */
export function splitCommentSegments(text) {
  const input = text ?? "";
  const segments = [];
  let lastIndex = 0;
  let match;

  MERMAID_FENCE_REGEX.lastIndex = 0;
  while ((match = MERMAID_FENCE_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: input.slice(lastIndex, match.index),
      });
    }

    segments.push({
      type: "mermaid",
      content: match[1].trim(),
    });
    lastIndex = MERMAID_FENCE_REGEX.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      type: "text",
      content: input.slice(lastIndex),
    });
  }

  if (segments.length === 0) {
    return [{ type: "text", content: input }];
  }

  return segments;
}

/**
 * @param {string} source
 * @returns {boolean}
 */
export function hasMermaidBlocks(source) {
  MERMAID_FENCE_REGEX.lastIndex = 0;
  return MERMAID_FENCE_REGEX.test(source ?? "");
}

/**
 * 建立 mermaid.ink PNG 圖片 URL
 * @param {string} mermaidSource
 * @returns {string}
 */
export function buildMermaidInkImageUrl(mermaidSource) {
  const encoded = Buffer.from(mermaidSource, "utf8").toString("base64url");
  return `https://mermaid.ink/img/${encoded}`;
}

/**
 * 確認 mermaid.ink 可成功渲染
 * @param {string} imageUrl
 * @returns {Promise<{ ok: boolean, contentType?: string, status?: number, error?: string }>}
 */
export async function validateMermaidImageUrl(imageUrl) {
  try {
    const response = await fetch(imageUrl, { method: "GET" });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `mermaid.ink returned ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return {
        ok: false,
        status: response.status,
        contentType,
        error: `unexpected content-type: ${contentType}`,
      };
    }

    return { ok: true, contentType, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * @param {string} url
 * @param {string} alt
 * @returns {Object}
 */
export function makeExternalMediaSingleNode(url, alt = "flowchart") {
  return {
    type: "mediaSingle",
    attrs: {
      layout: "center",
    },
    content: [
      {
        type: "media",
        attrs: {
          type: "external",
          url,
          alt,
        },
      },
    ],
  };
}

/**
 * @param {string} source
 * @returns {Object}
 */
export function makeMermaidCodeBlockNode(source) {
  return {
    type: "codeBlock",
    attrs: {
      language: "mermaid",
    },
    content: [
      {
        type: "text",
        text: source,
      },
    ],
  };
}

/**
 * 將 Mermaid 區塊渲染為 ADF 節點（圖片優先，失敗時 fallback codeBlock）
 * @param {string} mermaidSource
 * @param {number} index
 * @returns {Promise<{ nodes: Object[], imageUrl?: string, fallback?: boolean, warning?: string }>}
 */
export async function renderMermaidToAdfNodes(mermaidSource, index = 1) {
  const imageUrl = buildMermaidInkImageUrl(mermaidSource);
  const validation = await validateMermaidImageUrl(imageUrl);

  if (validation.ok) {
    return {
      nodes: [
        makeExternalMediaSingleNode(imageUrl, `flowchart-${index}`),
      ],
      imageUrl,
      fallback: false,
    };
  }

  return {
    nodes: [makeMermaidCodeBlockNode(mermaidSource)],
    imageUrl,
    fallback: true,
    warning:
      validation.error ||
      `Failed to render flowchart #${index}; fallback to mermaid code block`,
  };
}

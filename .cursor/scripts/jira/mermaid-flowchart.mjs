#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/jira/mermaid-flowchart.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8250
 */
/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * @description 用於 Jira 留言中的 Mermaid 區塊轉換：可優先將流程圖渲染成 mermaid.ink 圖片並嵌入 ADF external media 節點；若渲染驗證失敗則回退為 mermaid codeBlock 節點。
 * @purpose 用於 Jira 留言中的 Mermaid 區塊轉換流程。
 */

/**
 * Mermaid 流程圖 fenced code block 分割規則
 * @description 使用正規表示式擷取 ```mermaid ... ``` 區塊內文。
 * @purpose 搭配留言文本分段，供後續渲染流程使用。
 */
const MERMAID_FENCE_REGEX = /```mermaid\s*\n([\s\S]*?)```/g;

/**
 * 解析留言中的 Mermaid fenced code blocks
 * @description 將輸入文字依照 ```mermaid``` fenced 區塊切分為純文字與 mermaid 區段。
 * @purpose 供後續逐段渲染或決定是否落回 codeBlock。
 * @external https://innotech.atlassian.net/browse/FE-8250
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
 * 檢查來源文字是否包含 Mermaid fenced code blocks
 * @description 以同一套 fenced 規則判斷是否存在 ```mermaid``` 區塊。
 * @purpose 在渲染前做快速判斷。
 * @external https://innotech.atlassian.net/browse/FE-8250
 * @param {string} source
 * @returns {boolean}
 */
export function hasMermaidBlocks(source) {
  MERMAID_FENCE_REGEX.lastIndex = 0;
  return MERMAID_FENCE_REGEX.test(source ?? "");
}

/**
 * 建立 mermaid.ink PNG 圖片 URL
 * @description 將 Mermaid 原始碼以 UTF-8 base64url 編碼，拼接到 mermaid.ink 圖片端點。
 * @purpose 供後續圖片驗證與嵌入 ADF media 節點使用。
 * @external https://innotech.atlassian.net/browse/FE-8250
 * @param {string} mermaidSource
 * @returns {string}
 */
export function buildMermaidInkImageUrl(mermaidSource) {
  const encoded = Buffer.from(mermaidSource, "utf8").toString("base64url");
  return `https://mermaid.ink/img/${encoded}`;
}

/**
 * 確認 mermaid.ink 可成功渲染
 * @description 透過 GET 取得圖片，檢查 response.ok 與 content-type 是否為 image/*。
 * @purpose 決定是否以 external media 方式嵌入，或回退到 mermaid codeBlock。
 * @external https://innotech.atlassian.net/browse/FE-8250
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
 * 建立 ADF mediaSingle（external media）節點
 * @description 以 Jira ADF mediaSingle 結構組裝 external media 節點，並設定 layout 與 alt。
 * @purpose 用於成功渲染圖片時的 ADF 嵌入。
 * @external https://innotech.atlassian.net/browse/FE-8250
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
 * 建立 ADF codeBlock（language=mermaid）節點
 * @description 以 codeBlock 節點包裹 mermaid 原始碼字串。
 * @purpose 用於圖片渲染失敗時的回退顯示。
 * @external https://innotech.atlassian.net/browse/FE-8250
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
 * @description 先產生 mermaid.ink 圖片 URL，再呼叫驗證；驗證成功則回傳 external mediaSingle 節點，否則回退為 mermaid codeBlock 節點，並附帶 warning。
 * @purpose 讓 Jira 留言中的 Mermaid 既能顯示圖片，也能在外部渲染失敗時仍保留原始碼。
 * @external https://innotech.atlassian.net/browse/FE-8250
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

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-13
 * @llm-review-model annotation-refactor-engine
 * @llm-review-note 依需求將檔案註解調整為三段式區塊，並依 declarationOrigins 對宣告註解補上對應 @external（無票則省略），不改動任何 runtime 邏輯。
 */
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T17:54:55.809Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Adjusted only comment annotations to follow the required three-section layout, normalized declaration comment tag styles, and omitted @external where no declaration ticket exists. No runtime logic changed.
 */

#!/usr/bin/env node

/**
 * 檔案用途區塊
 * @module read-confluence-page
 * @purpose 讀取 Confluence 頁面並以 Agent-first 格式輸出
 * @external https://innotech.atlassian.net/browse/FE-8389
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";
import {
  buildMeta,
  logProgress,
  parseExternalOutputArgs,
  truncateText,
  writeScriptError,
  writeScriptResult,
} from "../utilities/external-output.mjs";

/**
 * @description 解析 Confluence URL
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function parseConfluenceUrl(url) {
  const match = url.match(/\/wiki\/spaces\/([^/]+)\/pages\/(\d+)(?:\/|$)/);
  if (!match) return null;

  return {
    spaceKey: match[1],
    pageId: match[2],
  };
}

/**
 * @description ADF 轉純文字
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export function extractTextFromADF(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.text) return item.text;
        if (item?.content) return extractTextFromADF(item.content);
        return "";
      })
      .join("\n");
  }
  if (content?.text) return content.text;
  if (content?.content) return extractTextFromADF(content.content);
  return "";
}

/**
 * @description 讀取 Confluence 頁面
 * @external https://innotech.atlassian.net/browse/FE-8389
 */
export async function readConfluencePage(url, userOptions = {}) {
  const options = {
    maxChars: 8000,
    includeRaw: false,
    ...userOptions,
  };

  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  const parsed = parseConfluenceUrl(url);
  if (!parsed) {
    throw new Error(
      `無法解析 Confluence URL: ${url}\n格式應為: https://innotech.atlassian.net/wiki/spaces/{spaceKey}/pages/{pageId}/...`
    );
  }

  const { spaceKey, pageId } = parsed;
  const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,body.view,version,space`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`找不到 Confluence 頁面: ${pageId}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
    }
    throw new Error(`獲取 Confluence 頁面失敗: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  let contentRaw = "";
  if (data.body?.storage?.value) {
    try {
      const adfContent = JSON.parse(data.body.storage.value);
      contentRaw = extractTextFromADF(adfContent);
    } catch {
      contentRaw = data.body.storage.value;
    }
  } else if (data.body?.view?.value) {
    contentRaw = data.body.view.value;
  } else if (data.body?.storage?.representation === "wiki") {
    contentRaw = data.body.storage.value || "";
  }

  const contentResult = truncateText(contentRaw, options.maxChars);

  const payload = {
    source: "confluence",
    url,
    pageId,
    spaceKey,
    space: data.space?.name || spaceKey,
    title: data.title || "無標題",
    version: data.version?.number || 1,
    content: contentResult.text,
    meta: buildMeta({
      truncated: contentResult.truncated,
      contentTotalChars: contentResult.totalChars,
      contentReturnedChars: contentResult.returnedChars,
      hasMoreContent: contentResult.truncated,
      hints: contentResult.truncated ? { nextSections: ["content"] } : {},
    }),
  };

  if (options.includeRaw) {
    payload.raw = data;
  }

  return payload;
}

function showHelp() {
  logProgress(`
Confluence 頁面讀取工具（Agent-first Output）

用法:
  node read-confluence-page.mjs <confluence-url>
  node read-confluence-page.mjs <url> --format=agent --max-chars=12000

參數:
  --format=agent|human|json  輸出格式
  --include-raw              包含完整 API payload
  --max-chars=<n>            content 上限（預設 8000）
  --help                     顯示說明
`);
}

async function main() {
  const args = parseExternalOutputArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  const url = args.positional[0] || args.url;

  if (!url) {
    writeScriptError("請提供 Confluence 頁面 URL", "MISSING_URL");
  }

  try {
    logProgress(`Reading Confluence page ${url}...`);
    const result = await readConfluencePage(url, args);
    writeScriptResult(result, args.resolvedFormat);
  } catch (error) {
    writeScriptError(error.message, "READ_CONFLUENCE_FAILED");
  }
}

main();

/**
 * llm 分析紀錄區
 * @llm-review-submitted-at 2026-06-14T12:00:00.000Z
 * @llm-review-model composer-2.5-fast
 * @llm-review-note FE-8389 Phase 1：移除預設 raw、截斷/meta、format 支援。
 */

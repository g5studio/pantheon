#!/usr/bin/env node

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */
/**
 * @module read-confluence-page
 * @purpose 讀取 Confluence 頁面內容，並透過 Jira API token（Basic Auth）呼叫 Confluence REST API。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 讀取流程支援用
 */
/**
 * 宣告內容用途說明與單號關聯
 * @description 讀取 Confluence 頁面內容
 * @purpose 使用 Jira API token 透過 Confluence API 訪問頁面
 */

import { getJiraConfig } from "../utilities/env-loader.mjs";

// 從 Confluence URL 解析空間和頁面 ID
/**
 * 宣告內容用途說明與單號關聯
 * @description 解析 Confluence URL 以取得 spaceKey 與 pageId。
 * @purpose 協助後續呼叫 Confluence REST API。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function parseConfluenceUrl(url) {
  // 格式: https://innotech.atlassian.net/wiki/spaces/{spaceKey}/pages/{pageId}/...
  /**
   * 宣告內容用途說明與單號關聯
   * @description 以正則擷取 URL 中的 spaceKey 與 pageId。
   * @purpose 支援固定路徑格式解析。
   * @external https://innotech.atlassian.net/browse/FE-7893
   */
  const match = url.match(/\/wiki\/spaces\/([^\/]+)\/pages\/(\d+)(?:\/|$)/);
  if (match) {
    return {
      spaceKey: match[1],
      pageId: match[2],
    };
  }
  return null;
}

// 提取 ADF 格式的文本內容
/**
 * 宣告內容用途說明與單號關聯
 * @description 將 ADF（Atlassian Document Format）內容轉換成純文字。
 * @purpose 讓頁面內容可直接輸出或後續處理。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
function extractTextFromADF(content) {
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

// 讀取 Confluence 頓面
/**
 * 宣告內容用途說明與單號關聯
 * @description 依 Confluence URL 解析後呼叫 Confluence REST API，取得頁面標題、空間與內容。
 * @purpose 供 CLI 輸出結構化頁面結果（含 raw 原始資料）。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
async function readConfluencePage(url) {
  /**
   * 宣告內容用途說明與單號關聯
   * @description 取得 Jira/Confluence 呼叫所需設定（如 email、apiToken、baseUrl）。
   * @purpose 支援 Basic Auth 與 API 端點組裝。
   * @external https://innotech.atlassian.net/browse/FE-7893
   */
  const config = getJiraConfig();
  /**
   * 宣告內容用途說明與單號關聯
   * @description 將 email 與 apiToken 組合成 Basic Auth 的 base64 字串。
   * @purpose 用於呼叫 Confluence REST API 的授權 header。
   */
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  // 注意：此處僅調整尾端斜線，避免拼接 URL 出現雙斜線
  /**
   * 宣告內容用途說明與單號關聯
   * @description 讓 baseUrl 不以 "/" 結尾，以避免組 URL 時出現雙斜線。
   * @purpose 確保 API URL 正確串接。
   * @external https://innotech.atlassian.net/browse/FE-7893
   */
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;

  // 解析 URL
  /**
   * 宣告內容用途說明與單號關聯
   * @description 解析傳入的 Confluence URL，取得 spaceKey 與 pageId。
   * @purpose 進一步組裝 REST API 端點。
   * @external https://innotech.atlassian.net/browse/FE-7893
   */
  const parsed = parseConfluenceUrl(url);
  if (!parsed) {
    throw new Error(
      `無法解析 Confluence URL: ${url}\n格式應為: https://innotech.atlassian.net/wiki/spaces/{spaceKey}/pages/{pageId}/...`
    );
  }

  /**
   * 宣告內容用途說明與單號關聯
   * @description 解構解析結果中的 spaceKey 與 pageId。
   * @purpose 供後續取得頁面內容。
   * @external https://innotech.atlassian.net/browse/FE-7893
   */
  const { spaceKey, pageId } = parsed;

  // 使用 Confluence REST API 獲取頁面內容
  // API 端點: /wiki/rest/api/content/{id}?expand=body.storage,version
  const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,body.view,version,space`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Confluence 頁面: ${pageId}`);
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Jira API Token 已過期或無權限，請聯繫 william.chiang");
      } else {
        throw new Error(
          `獲取 Confluence 頁面失敗: ${response.status} ${response.statusText}`
        );
      }
    }

    const data = await response.json();

    // 提取頁面信息
    const title = data.title || "無標題";
    const space = data.space?.name || spaceKey;
    const version = data.version?.number || 1;

    // 提取內容（優先使用 storage 格式，如果沒有則使用 view 格式）
    let content = "";
    if (data.body?.storage?.value) {
      // Storage 格式（ADF - Atlassian Document Format）
      try {
        const adfContent = JSON.parse(data.body.storage.value);
        content = extractTextFromADF(adfContent);
      } catch (e) {
        // 如果不是 JSON，可能是 HTML 或其他格式
        content = data.body.storage.value;
      }
    } else if (data.body?.view?.value) {
      // View 格式（HTML）
      content = data.body.view.value;
    } else if (data.body?.storage?.representation === "wiki") {
      // Wiki 格式
      content = data.body.storage.value || "";
    }

    return {
      url,
      pageId,
      spaceKey,
      space,
      title,
      version,
      content,
      raw: data, // 保留原始數據以便進一步處理
    };
  } catch (error) {
    if (error.message.includes("Jira API Token")) {
      throw error;
    }
    throw new Error(`讀取 Confluence 頁面失敗: ${error.message}`);
  }
}

// 主函數
/**
 * 宣告內容用途說明與單號關聯
 * @description 作為 CLI 入口：接收 Confluence URL，呼叫 readConfluencePage 並輸出 JSON。
 * @purpose 支援命令列取得指定頁面內容。
 * @external https://innotech.atlassian.net/browse/FE-7893
 */
async function main() {
  /**
   * 宣告內容用途說明與單號關聯
   * @description 從命令列參數取得 Confluence 頁面 URL。
   * @purpose 作為 readConfluencePage 的輸入。
   * @external https://innotech.atlassian.net/browse/FE-7893
   */
  const url = process.argv[2];

  if (!url) {
    console.error("❌ 請提供 Confluence 頁面 URL");
    console.error("\n使用方法:");
    console.error("  node read-confluence-page.mjs <confluence-url>");
    console.error("\n範例:");
    console.error(
      '  node read-confluence-page.mjs "https://innotech.atlassian.net/wiki/spaces/Frontend/pages/4078010378/Agent+Operator+Guideline"'
    );
    process.exit(1);
  }

  try {
    const result = await readConfluencePage(url);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

main();
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T17:55:15.864Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 將檔案註解調整為三段式布局：補齊並移除底部重複/錯置的 llm 區塊字串；修正 malformed 之 @external（auth 區塊不再帶未對應票號）；並將多處標題/區塊註解格式統一為指定的 @module/@purpose/@external、@description/@purpose 及 llm 分析記錄格式。未變更任何執行邏輯。
 */

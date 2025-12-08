#!/usr/bin/env node

/**
 * 讀取 GitLab MR 的 AI review comments
 *
 * 功能：
 * 1. 從 MR URL 提取並獲取所有 discussions
 * 2. 篩選出由指定 service account 發布的 unresolved comments
 * 3. 輸出 comments 供 AI 分析和處理
 * 4. 提供回覆 comment 和解決 comment 的功能
 * 5. 重新提交 AI review
 */

import { execSync } from "child_process";
import {
  getProjectRoot,
  getGitLabToken,
  getCompassApiToken,
  getJiraEmail,
} from "../utilities/env-loader.mjs";

const projectRoot = getProjectRoot();

// AI Review Service Account 的 username
const AI_REVIEW_SERVICE_ACCOUNT = "service_account_8131c1c3f99badd3c4938c05fa68088b";

/**
 * 執行命令
 */
function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.silent) {
      console.error(`錯誤: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 檢查是否安裝了 glab
 */
function hasGlab() {
  try {
    exec("which glab", { silent: true });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 檢查 glab 是否已登入
 */
function isGlabAuthenticated(hostname) {
  try {
    const result = exec(`glab auth status --hostname ${hostname}`, {
      silent: true,
    });
    return result.includes("authenticated") || result.includes("✓");
  } catch (error) {
    return false;
  }
}

/**
 * 從 MR URL 解析項目路徑和 MR IID
 *
 * @param {string} mrUrl - MR URL，例如 https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366
 * @returns {Object} { host, projectPath, mrIid }
 */
function parseMRUrl(mrUrl) {
  // 支援格式：
  // https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366
  // https://gitlab.service-hub.tech/group/subgroup/project/-/merge_requests/123

  const urlPattern = /^(https?:\/\/[^/]+)\/(.+)\/-\/merge_requests\/(\d+)/;
  const match = mrUrl.match(urlPattern);

  if (!match) {
    throw new Error(`無效的 MR URL: ${mrUrl}`);
  }

  const [, host, projectPath, mrIid] = match;
  return {
    host,
    projectPath: encodeURIComponent(projectPath),
    projectPathRaw: projectPath,
    mrIid: parseInt(mrIid, 10),
  };
}

/**
 * 獲取 GitLab user email（優先使用 glab，其次 API）
 */
async function getGitLabUserEmail(hostname = "gitlab.service-hub.tech") {
  // 方法 1: 嘗試使用 glab 獲取用戶信息
  if (hasGlab() && isGlabAuthenticated(hostname)) {
    try {
      const result = exec("glab api user", { silent: true });
      if (result && result.trim()) {
        const userInfo = JSON.parse(result);
        if (userInfo && userInfo.email) {
          return userInfo.email;
        }
      }
    } catch (error) {
      // glab 獲取失敗，繼續嘗試其他方法
    }
  }

  // 方法 2: 嘗試使用 API token 獲取用戶信息
  try {
    const token = getGitLabToken();
    if (token) {
      const response = await fetch(`https://${hostname}/api/v4/user`, {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      });

      if (response.ok) {
        const userInfo = await response.json();
        if (userInfo && userInfo.email) {
          return userInfo.email;
        }
      }
    }
  } catch (error) {
    // API 獲取失敗
  }

  return null;
}

/**
 * 獲取 MR 的所有 discussions
 *
 * @param {string} token - GitLab API token
 * @param {string} host - GitLab host
 * @param {string} projectPath - 編碼後的項目路徑
 * @param {number} mrIid - MR IID
 * @returns {Promise<Array>} discussions 列表
 */
async function getMRDiscussions(token, host, projectPath, mrIid) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/discussions`;

  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`獲取 MR discussions 失敗: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * 獲取 MR 詳情
 *
 * @param {string} token - GitLab API token
 * @param {string} host - GitLab host
 * @param {string} projectPath - 編碼後的項目路徑
 * @param {number} mrIid - MR IID
 * @returns {Promise<Object>} MR 詳情
 */
async function getMRDetails(token, host, projectPath, mrIid) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;

  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`獲取 MR 詳情失敗: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * 篩選 AI review service account 的 unresolved comments
 *
 * @param {Array} discussions - 所有 discussions
 * @returns {Array} 符合條件的 comments
 */
function filterAIReviewComments(discussions) {
  const aiReviewComments = [];

  for (const discussion of discussions) {
    // 跳過已解決的 discussions
    if (discussion.notes?.[0]?.resolved) {
      continue;
    }

    // 檢查 discussion 中的第一個 note（通常是原始評論）
    const firstNote = discussion.notes?.[0];
    if (!firstNote) continue;

    // 檢查是否由 AI review service account 發布
    if (firstNote.author?.username === AI_REVIEW_SERVICE_ACCOUNT) {
      aiReviewComments.push({
        discussionId: discussion.id,
        noteId: firstNote.id,
        body: firstNote.body,
        position: firstNote.position,
        filePath: firstNote.position?.new_path || firstNote.position?.old_path,
        lineNumber: firstNote.position?.new_line || firstNote.position?.old_line,
        createdAt: firstNote.created_at,
        resolved: firstNote.resolved || false,
        resolvable: firstNote.resolvable || false,
        // 收集所有回覆
        replies: discussion.notes.slice(1).map((note) => ({
          noteId: note.id,
          body: note.body,
          author: note.author?.username,
          createdAt: note.created_at,
        })),
      });
    }
  }

  return aiReviewComments;
}

/**
 * 回覆 discussion
 *
 * @param {string} token - GitLab API token
 * @param {string} host - GitLab host
 * @param {string} projectPath - 編碼後的項目路徑
 * @param {number} mrIid - MR IID
 * @param {string} discussionId - Discussion ID
 * @param {string} body - 回覆內容
 * @returns {Promise<Object>} 新建的 note
 */
async function replyToDiscussion(token, host, projectPath, mrIid, discussionId, body) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/discussions/${discussionId}/notes`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`回覆 discussion 失敗: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * 解決 discussion
 *
 * @param {string} token - GitLab API token
 * @param {string} host - GitLab host
 * @param {string} projectPath - 編碼後的項目路徑
 * @param {number} mrIid - MR IID
 * @param {string} discussionId - Discussion ID
 * @returns {Promise<Object>} 更新後的 discussion
 */
async function resolveDiscussion(token, host, projectPath, mrIid, discussionId) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/discussions/${discussionId}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ resolved: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`解決 discussion 失敗: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * 提交 AI review
 *
 * @param {string} mrUrl - MR URL
 * @returns {Promise<Object>} API 回應
 */
async function submitAIReview(mrUrl) {
  const apiKey = getCompassApiToken();
  if (!apiKey) {
    throw new Error("無法獲取 Compass API token，請設置 COMPASS_API_TOKEN");
  }

  // 獲取 email
  const email = await getGitLabUserEmail() || getJiraEmail();
  if (!email) {
    throw new Error("無法獲取 email，請設置 GitLab token 或 Jira email");
  }

  console.log(`📧 使用 email: ${email} 提交 AI review`);

  const apiUrl =
    "https://mac09demac-mini.balinese-python.ts.net/api/workflows/jobs";

  const requestBody = {
    taskId: "code-review",
    version: "v1",
    input: {
      mergeRequestUrl: mrUrl,
      email: email,
      llm: {
        provider: "openai",
        model: "gpt-5-2025-08-07",
      },
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `AI review API 請求失敗: ${response.status} ${errorText}`
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`提交 AI review 失敗: ${error.message}`);
  }
}

/**
 * 獲取檔案內容（用於讓 AI 理解上下文）
 *
 * @param {string} token - GitLab API token
 * @param {string} host - GitLab host
 * @param {string} projectPath - 編碼後的項目路徑
 * @param {string} ref - branch 或 commit ref
 * @param {string} filePath - 檔案路徑
 * @returns {Promise<string>} 檔案內容
 */
async function getFileContent(token, host, projectPath, ref, filePath) {
  const url = `${host}/api/v4/projects/${projectPath}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`;

  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const errorText = await response.text();
    throw new Error(`獲取檔案內容失敗: ${response.status} ${errorText}`);
  }

  return await response.text();
}

/**
 * 主函數：列出 AI review comments
 */
async function listAIReviewComments(mrUrl) {
  const token = getGitLabToken();
  if (!token) {
    throw new Error("未找到 GitLab token，請設置 GITLAB_TOKEN");
  }

  const { host, projectPath, projectPathRaw, mrIid } = parseMRUrl(mrUrl);

  console.log(`\n🔍 正在獲取 MR !${mrIid} 的 AI review comments...\n`);

  // 獲取 MR 詳情
  const mrDetails = await getMRDetails(token, host, projectPath, mrIid);
  console.log(`📋 MR 標題: ${mrDetails.title}`);
  console.log(`🌿 來源分支: ${mrDetails.source_branch}`);
  console.log(`🎯 目標分支: ${mrDetails.target_branch}\n`);

  // 獲取所有 discussions
  const discussions = await getMRDiscussions(token, host, projectPath, mrIid);
  console.log(`📝 總共 ${discussions.length} 個 discussions\n`);

  // 篩選 AI review comments
  const aiReviewComments = filterAIReviewComments(discussions);

  if (aiReviewComments.length === 0) {
    console.log("✅ 沒有未解決的 AI review comments\n");
    return {
      mrDetails,
      comments: [],
    };
  }

  console.log(`⚠️  發現 ${aiReviewComments.length} 個未解決的 AI review comments:\n`);
  console.log("=".repeat(80));

  for (let i = 0; i < aiReviewComments.length; i++) {
    const comment = aiReviewComments[i];
    console.log(`\n【Comment ${i + 1}/${aiReviewComments.length}】`);
    console.log(`📁 檔案: ${comment.filePath || "N/A"}`);
    console.log(`📍 行號: ${comment.lineNumber || "N/A"}`);
    console.log(`🆔 Discussion ID: ${comment.discussionId}`);
    console.log(`📅 建立時間: ${comment.createdAt}`);
    console.log("-".repeat(80));
    console.log("💬 Comment 內容:");
    console.log(comment.body);

    if (comment.replies.length > 0) {
      console.log("-".repeat(40));
      console.log(`💬 已有 ${comment.replies.length} 個回覆:`);
      for (const reply of comment.replies) {
        console.log(`  @${reply.author}: ${reply.body.substring(0, 100)}...`);
      }
    }

    console.log("=".repeat(80));
  }

  return {
    mrDetails,
    comments: aiReviewComments,
    token,
    host,
    projectPath,
    mrIid,
  };
}

/**
 * 主入口
 */
async function main() {
  const args = process.argv.slice(2);

  // 解析命令
  const command = args[0];

  if (!command) {
    console.log(`
📋 fix-comment 腳本使用說明

用法:
  node fix-comment.mjs list <MR_URL>              列出所有未解決的 AI review comments
  node fix-comment.mjs reply <MR_URL> <DISCUSSION_ID> <BODY>  回覆指定的 comment
  node fix-comment.mjs resolve <MR_URL> <DISCUSSION_ID>       解決指定的 comment
  node fix-comment.mjs resubmit <MR_URL>          重新提交 AI review

範例:
  node fix-comment.mjs list "https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366"
  node fix-comment.mjs reply "https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366" "abc123" "已修正"
  node fix-comment.mjs resolve "https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366" "abc123"
  node fix-comment.mjs resubmit "https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366"
`);
    process.exit(0);
  }

  try {
    switch (command) {
      case "list": {
        const mrUrl = args[1];
        if (!mrUrl) {
          console.error("❌ 請提供 MR URL");
          process.exit(1);
        }
        const result = await listAIReviewComments(mrUrl);
        // 輸出 JSON 格式供 AI 解析
        console.log("\n📤 JSON 輸出（供 AI 解析）:");
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "reply": {
        const mrUrl = args[1];
        const discussionId = args[2];
        const body = args.slice(3).join(" ");

        if (!mrUrl || !discussionId || !body) {
          console.error("❌ 請提供 MR URL、Discussion ID 和回覆內容");
          process.exit(1);
        }

        const token = getGitLabToken();
        if (!token) {
          throw new Error("未找到 GitLab token，請設置 GITLAB_TOKEN");
        }

        const { host, projectPath, mrIid } = parseMRUrl(mrUrl);
        console.log(`\n💬 正在回覆 discussion ${discussionId}...`);
        const note = await replyToDiscussion(token, host, projectPath, mrIid, discussionId, body);
        console.log(`✅ 回覆成功！Note ID: ${note.id}\n`);
        break;
      }

      case "resolve": {
        const mrUrl = args[1];
        const discussionId = args[2];

        if (!mrUrl || !discussionId) {
          console.error("❌ 請提供 MR URL 和 Discussion ID");
          process.exit(1);
        }

        const token = getGitLabToken();
        if (!token) {
          throw new Error("未找到 GitLab token，請設置 GITLAB_TOKEN");
        }

        const { host, projectPath, mrIid } = parseMRUrl(mrUrl);
        console.log(`\n✔️  正在解決 discussion ${discussionId}...`);
        await resolveDiscussion(token, host, projectPath, mrIid, discussionId);
        console.log(`✅ Discussion 已解決！\n`);
        break;
      }

      case "resubmit": {
        const mrUrl = args[1];
        if (!mrUrl) {
          console.error("❌ 請提供 MR URL");
          process.exit(1);
        }

        console.log(`\n🤖 正在重新提交 AI review...`);
        const result = await submitAIReview(mrUrl);
        console.log(`✅ AI review 已提交！`);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(`❌ 未知命令: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ 錯誤: ${error.message}\n`);
    process.exit(1);
  }
}

// 導出函數供其他模組使用
export {
  parseMRUrl,
  getMRDiscussions,
  getMRDetails,
  filterAIReviewComments,
  replyToDiscussion,
  resolveDiscussion,
  submitAIReview,
  getFileContent,
  listAIReviewComments,
  AI_REVIEW_SERVICE_ACCOUNT,
};

main();


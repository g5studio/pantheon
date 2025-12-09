#!/usr/bin/env node

/**
 * GitLab MR 留言與回覆腳本
 *
 * 支援功能：
 * 1. 在 MR 上新增留言（note）
 * 2. 回覆指定的討論（discussion）
 * 3. 列出 MR 的所有討論
 *
 * 使用方式：
 *   # 新增留言
 *   node mr-comment.mjs --mr=123 --message="留言內容"
 *   node mr-comment.mjs --mr-url="https://gitlab.../merge_requests/123" --message="留言內容"
 *
 *   # 回覆討論
 *   node mr-comment.mjs --mr=123 --discussion=abc123 --message="回覆內容"
 *
 *   # 列出討論
 *   node mr-comment.mjs --mr=123 --list-discussions
 *
 *   # 在特定檔案行留言（建立新討論）
 *   node mr-comment.mjs --mr=123 --message="留言" --file="src/app.ts" --line=42 --line-type=new
 */

import { execSync } from "child_process";
import { getProjectRoot, getGitLabToken } from "../utilities/env-loader.mjs";

const projectRoot = getProjectRoot();

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

// 獲取項目信息
function getProjectInfo() {
  const remoteUrl = exec("git config --get remote.origin.url", {
    silent: true,
  }).trim();

  if (remoteUrl.startsWith("git@")) {
    const match = remoteUrl.match(/git@([^:]+):(.+)/);
    if (match) {
      const [, host, path] = match;
      return {
        host: `https://${host}`,
        projectPath: encodeURIComponent(path.replace(/\.git$/, "")),
        fullPath: path.replace(/\.git$/, ""),
      };
    }
  }

  if (remoteUrl.startsWith("https://")) {
    const url = new URL(remoteUrl);
    const pathParts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    return {
      host: `${url.protocol}//${url.host}`,
      projectPath: encodeURIComponent(pathParts.join("/")),
      fullPath: pathParts.join("/"),
    };
  }

  throw new Error("無法解析 remote URL");
}

// 從 MR URL 解析 MR ID
function parseMRUrl(mrUrl) {
  const match = mrUrl.match(/merge_requests\/(\d+)/);
  if (match) {
    return match[1];
  }
  throw new Error(`無法從 URL 解析 MR ID: ${mrUrl}`);
}

// 獲取 MR 信息
async function getMRInfo(token, host, projectPath, mrIid) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`;
  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`獲取 MR 信息失敗: ${response.status} ${error}`);
  }

  return await response.json();
}

// 在 MR 上新增留言
async function createNote(token, host, projectPath, mrIid, message) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: message }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`新增留言失敗: ${response.status} ${error}`);
  }

  return await response.json();
}

// 建立新討論（可選：在特定代碼行）
async function createDiscussion(
  token,
  host,
  projectPath,
  mrIid,
  message,
  position = null
) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/discussions`;

  const body = { body: message };

  // 如果有指定位置，則建立代碼行討論
  if (position) {
    body.position = position;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`建立討論失敗: ${response.status} ${error}`);
  }

  return await response.json();
}

// 回覆指定的討論
async function replyToDiscussion(
  token,
  host,
  projectPath,
  mrIid,
  discussionId,
  message
) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/discussions/${discussionId}/notes`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body: message }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`回覆討論失敗: ${response.status} ${error}`);
  }

  return await response.json();
}

// 列出 MR 的所有討論
async function listDiscussions(token, host, projectPath, mrIid) {
  const url = `${host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/discussions`;
  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`獲取討論列表失敗: ${response.status} ${error}`);
  }

  return await response.json();
}

// 解析命令行參數
function parseArgs(args) {
  const result = {};

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      const value = valueParts.length > 0 ? valueParts.join("=") : true;
      result[key] = value;
    }
  }

  return result;
}

// 顯示使用說明
function showUsage() {
  console.log(`
GitLab MR 留言與回覆腳本

使用方式：
  # 新增留言（簡單 note）
  node mr-comment.mjs --mr=<MR_ID> --message="留言內容"
  node mr-comment.mjs --mr-url="<MR_URL>" --message="留言內容"

  # 建立新討論（discussion）
  node mr-comment.mjs --mr=<MR_ID> --message="留言內容" --as-discussion

  # 回覆指定討論
  node mr-comment.mjs --mr=<MR_ID> --discussion=<DISCUSSION_ID> --message="回覆內容"

  # 在特定檔案行建立討論
  node mr-comment.mjs --mr=<MR_ID> --message="留言" --file="src/app.ts" --line=42

  # 列出所有討論
  node mr-comment.mjs --mr=<MR_ID> --list-discussions

  # 列出討論（含詳細內容）
  node mr-comment.mjs --mr=<MR_ID> --list-discussions --verbose

參數說明：
  --mr=<ID>           MR 的 IID（必須，或使用 --mr-url）
  --mr-url=<URL>      MR 的完整 URL（可替代 --mr）
  --message=<MSG>     留言或回覆內容（必須，除非 --list-discussions）
  --discussion=<ID>   要回覆的討論 ID
  --as-discussion     將留言作為新討論建立（而非簡單 note）
  --file=<PATH>       在特定檔案建立討論（需配合 --line）
  --line=<NUM>        在特定行號建立討論
  --line-type=<TYPE>  行號類型：old（舊版）或 new（新版，預設）
  --list-discussions  列出 MR 的所有討論
  --verbose           顯示詳細信息
  --help              顯示此說明

範例：
  # 在 MR !123 上留言
  node mr-comment.mjs --mr=123 --message="LGTM! 👍"

  # 回覆討論
  node mr-comment.mjs --mr=123 --discussion=abc123def --message="已修正，請再次檢查"

  # 在代碼行留言
  node mr-comment.mjs --mr=123 --message="這裡需要加上錯誤處理" --file="src/utils.ts" --line=42
`);
}

// 格式化討論輸出
function formatDiscussion(discussion, verbose = false) {
  const notes = discussion.notes || [];
  const firstNote = notes[0];

  if (!firstNote) return null;

  const lines = [];
  const isResolved = discussion.resolved;
  const resolvedIcon = isResolved ? "✅" : "💬";

  lines.push(`${resolvedIcon} Discussion ID: ${discussion.id}`);
  lines.push(`   作者: ${firstNote.author?.username || "Unknown"}`);
  lines.push(
    `   時間: ${new Date(firstNote.created_at).toLocaleString("zh-TW")}`
  );

  if (firstNote.position) {
    const pos = firstNote.position;
    lines.push(`   位置: ${pos.new_path}:${pos.new_line || pos.old_line}`);
  }

  if (verbose) {
    lines.push(
      `   內容: ${firstNote.body.substring(0, 200)}${
        firstNote.body.length > 200 ? "..." : ""
      }`
    );

    if (notes.length > 1) {
      lines.push(`   回覆數: ${notes.length - 1}`);
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 顯示幫助
  if (args.help) {
    showUsage();
    process.exit(0);
  }

  // 獲取 MR ID
  let mrIid = args.mr;
  if (!mrIid && args["mr-url"]) {
    mrIid = parseMRUrl(args["mr-url"]);
  }

  if (!mrIid) {
    console.error("❌ 請提供 --mr=<MR_ID> 或 --mr-url=<URL>\n");
    showUsage();
    process.exit(1);
  }

  // 獲取 GitLab token
  const token = getGitLabToken();
  if (!token) {
    console.error("❌ 未找到 GitLab token\n");
    console.error("請設置以下方式之一：");
    console.error("  1. 環境變數: export GITLAB_TOKEN=your-token");
    console.error("  2. .env.local: GITLAB_TOKEN=your-token");
    console.error(
      "  3. Git config: git config --global gitlab.token your-token\n"
    );
    process.exit(1);
  }

  // 獲取項目信息
  const projectInfo = getProjectInfo();
  console.log(`📍 項目: ${projectInfo.fullPath}`);
  console.log(`🔗 MR: !${mrIid}\n`);

  // 列出討論模式
  if (args["list-discussions"]) {
    console.log("📋 獲取討論列表...\n");

    const discussions = await listDiscussions(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid
    );

    if (discussions.length === 0) {
      console.log("此 MR 尚無任何討論。");
      return;
    }

    const unresolvedCount = discussions.filter(
      (d) => !d.resolved && d.notes?.length > 0
    ).length;
    const resolvedCount = discussions.filter((d) => d.resolved).length;

    console.log(
      `共 ${discussions.length} 個討論（💬 未解決: ${unresolvedCount}，✅ 已解決: ${resolvedCount}）\n`
    );

    for (const discussion of discussions) {
      const formatted = formatDiscussion(discussion, args.verbose);
      if (formatted) {
        console.log(formatted);
        console.log("");
      }
    }

    return;
  }

  // 檢查留言內容
  const message = args.message;
  if (!message) {
    console.error("❌ 請提供 --message=<留言內容>\n");
    showUsage();
    process.exit(1);
  }

  // 回覆討論模式
  if (args.discussion) {
    console.log(`💬 回覆討論 ${args.discussion}...\n`);

    const note = await replyToDiscussion(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid,
      args.discussion,
      message
    );

    console.log("✅ 回覆成功！\n");
    console.log(`📝 Note ID: ${note.id}`);
    console.log(`👤 作者: ${note.author?.username || "Unknown"}`);
    console.log(
      `🕐 時間: ${new Date(note.created_at).toLocaleString("zh-TW")}`
    );
    return;
  }

  // 在特定代碼行建立討論
  if (args.file && args.line) {
    console.log(`💬 在 ${args.file}:${args.line} 建立討論...\n`);

    // 獲取 MR 信息以取得 diff refs
    const mrInfo = await getMRInfo(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid
    );

    const position = {
      base_sha: mrInfo.diff_refs?.base_sha,
      start_sha: mrInfo.diff_refs?.start_sha,
      head_sha: mrInfo.diff_refs?.head_sha,
      position_type: "text",
      new_path: args.file,
      old_path: args.file,
    };

    // 設定行號
    if (args["line-type"] === "old") {
      position.old_line = parseInt(args.line, 10);
    } else {
      position.new_line = parseInt(args.line, 10);
    }

    const discussion = await createDiscussion(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid,
      message,
      position
    );

    console.log("✅ 討論建立成功！\n");
    console.log(`📝 Discussion ID: ${discussion.id}`);
    console.log(`📍 位置: ${args.file}:${args.line}`);
    return;
  }

  // 建立新討論（無特定位置）
  if (args["as-discussion"]) {
    console.log("💬 建立新討論...\n");

    const discussion = await createDiscussion(
      token,
      projectInfo.host,
      projectInfo.projectPath,
      mrIid,
      message
    );

    console.log("✅ 討論建立成功！\n");
    console.log(`📝 Discussion ID: ${discussion.id}`);
    console.log(
      `👤 作者: ${discussion.notes?.[0]?.author?.username || "Unknown"}`
    );
    return;
  }

  // 新增簡單留言（note）
  console.log("💬 新增留言...\n");

  const note = await createNote(
    token,
    projectInfo.host,
    projectInfo.projectPath,
    mrIid,
    message
  );

  console.log("✅ 留言成功！\n");
  console.log(`📝 Note ID: ${note.id}`);
  console.log(`👤 作者: ${note.author?.username || "Unknown"}`);
  console.log(`🕐 時間: ${new Date(note.created_at).toLocaleString("zh-TW")}`);

  // 輸出 MR 連結
  const mrUrl = `${projectInfo.host}/${projectInfo.fullPath}/-/merge_requests/${mrIid}`;
  console.log(`\n🔗 MR 連結: ${mrUrl}`);
}

main().catch((error) => {
  console.error(`\n❌ 發生錯誤: ${error.message}\n`);
  process.exit(1);
});

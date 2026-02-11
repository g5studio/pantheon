#!/usr/bin/env node

/**
 * 批次處理 Merge Requests：
 * - 檢查衝突（has_conflicts / detailed_merge_status）
 * - 依 `--labels` 過濾（例如 v5.38）
 * - 從 MR title/description 抓 ticket（FE-/IN-）
 * - 讀 Jira fixVersion → 推導預期 version label（vX.Y）→ 與 MR labels 比對（不符略過）
 * - 檢查 approvals（可要求特定使用者必須在 approved_by 中）
 * - 符合條件才合併
 * - 合併後將 Jira 主單狀態切到指定狀態（預設 PENDING DEPLOY STG）
 *
 * 監控機制：
 * - `--progress`：每處理一筆 MR，輸出一行 `BATCH_MERGE_PROGRESS {json}` 到 stderr
 *   用於 AI 在 chat 中逐筆回報（MR / ticket 超連結、作者、fix version、reason/reasonDetail）
 */

import { spawnSync } from "child_process";
import { setTimeout as sleep } from "timers/promises";
import { getJiraConfig } from "../utilities/env-loader.mjs";

function usage() {
  return [
    "batch-merge-mrs: missing required flags.",
    "",
    "This script is intentionally strict to avoid accidental merges/transitions.",
    "You must explicitly provide:",
    "- --labels=<label> (e.g. v5.38)",
    "- either --approved-by=<username> OR --no-approval-check",
    "- either --jira-to=<status> OR --no-jira-transition",
    "- either --dry-run OR --execute",
    "",
    "Examples:",
    '  node .cursor/scripts/admin/batch-merge-mrs.mjs --labels=v5.38 --approved-by=william.chiang --jira-to=\"PENDING DEPLOY STG\" --dry-run',
    "  node .cursor/scripts/admin/batch-merge-mrs.mjs --labels=v5.38 --no-approval-check --no-jira-transition --dry-run",
    "",
    "After reviewing dry-run output, re-run with --execute to actually merge.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opt = {
    host: "gitlab.service-hub.tech",
    project: ":id",
    state: "opened",
    labels: "v5.38",
    orderBy: "merged_at",
    sort: "desc",
    perPage: 100,
    mergeDelaySeconds: 1.5,
    jiraTargetStatus: "PENDING DEPLOY STG",
    transitionJira: true,
    // approvals
    requireApproved: true,
    requireApprovedBy: "william.chiang",
    // behavior
    skipDraft: true,
    progress: false,
    dryRun: false,
    // loop guard
    maxIterations: 1000,
    // upper bound
    maxProcess: 0,
  };

  const provided = {
    hasLabels: false,
    hasApprovalChoice: false,
    hasJiraChoice: false,
    action: /** @type {"dry-run" | "execute" | ""} */ (""),
  };
  const unknown = [];

  for (const raw of args) {
    const arg = raw.trim();
    if (!arg) continue;

    if (arg === "--progress") {
      opt.progress = true;
      continue;
    }
    if (arg === "--dry-run") {
      opt.dryRun = true;
      provided.action = "dry-run";
      continue;
    }
    if (arg === "--execute") {
      opt.dryRun = false;
      provided.action = "execute";
      continue;
    }
    if (arg === "--no-skip-draft") {
      opt.skipDraft = false;
      continue;
    }
    if (arg === "--no-jira-transition") {
      opt.transitionJira = false;
      provided.hasJiraChoice = true;
      continue;
    }
    if (arg === "--no-approval-check") {
      opt.requireApproved = false;
      provided.hasApprovalChoice = true;
      continue;
    }
    if (arg.startsWith("--host=")) {
      opt.host = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg.startsWith("--project=")) {
      opt.project = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg.startsWith("--state=")) {
      opt.state = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg.startsWith("--labels=")) {
      opt.labels = arg.split("=").slice(1).join("=");
      provided.hasLabels = true;
      continue;
    }
    if (arg.startsWith("--order-by=")) {
      opt.orderBy = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg.startsWith("--sort=")) {
      opt.sort = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg.startsWith("--per-page=")) {
      opt.perPage = Number(arg.split("=").slice(1).join("="));
      continue;
    }
    if (arg.startsWith("--delay=")) {
      opt.mergeDelaySeconds = Number(arg.split("=").slice(1).join("="));
      continue;
    }
    if (arg.startsWith("--jira-to=")) {
      opt.jiraTargetStatus = arg.split("=").slice(1).join("=");
      provided.hasJiraChoice = true;
      continue;
    }
    if (arg.startsWith("--approved-by=")) {
      opt.requireApprovedBy = arg.split("=").slice(1).join("=");
      opt.requireApproved = true;
      provided.hasApprovalChoice = true;
      continue;
    }
    if (arg.startsWith("--max-iterations=")) {
      opt.maxIterations = Number(arg.split("=").slice(1).join("="));
      continue;
    }
    if (arg.startsWith("--max-process=")) {
      opt.maxProcess = Number(arg.split("=").slice(1).join("="));
      continue;
    }

    unknown.push(arg);
  }

  if (!Number.isFinite(opt.perPage) || opt.perPage <= 0) opt.perPage = 100;
  if (opt.perPage > 100) opt.perPage = 100;

  if (!Number.isFinite(opt.mergeDelaySeconds) || opt.mergeDelaySeconds < 0) {
    opt.mergeDelaySeconds = 1.5;
  }

  if (!Number.isFinite(opt.maxIterations) || opt.maxIterations <= 0) {
    opt.maxIterations = 1000;
  }
  if (!Number.isFinite(opt.maxProcess) || opt.maxProcess < 0) {
    opt.maxProcess = 0;
  }

  // Strict validation
  if (args.length === 0) throw new Error(usage());
  if (unknown.length > 0) {
    throw new Error([`Unknown flags: ${unknown.join(", ")}`, "", usage()].join("\n"));
  }
  if (!provided.hasLabels) throw new Error(usage());
  if (!provided.hasApprovalChoice) throw new Error(usage());
  if (!provided.hasJiraChoice) throw new Error(usage());
  if (!provided.action) throw new Error(usage());

  return opt;
}

function execGlab(host, args, { silent = true } = {}) {
  const res = spawnSync("glab", args, {
    encoding: "utf-8",
    env: { ...process.env, GLAB_HOST: host },
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  const stdout = (res.stdout || "").toString();
  const stderr = (res.stderr || "").toString();

  if (res.error) throw new Error(`glab 執行失敗: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`glab 退出碼 ${res.status}: ${stderr || stdout}`.trim());
  }
  return stdout.trim();
}

function glabApiJson(host, endpoint) {
  const out = execGlab(host, ["api", endpoint], { silent: true });
  return out ? JSON.parse(out) : null;
}

function glabApiPutJson(host, endpoint) {
  const out = execGlab(host, ["api", "-X", "PUT", endpoint], { silent: true });
  return out ? JSON.parse(out) : null;
}

function jiraUrl(ticket) {
  return ticket ? `https://innotech.atlassian.net/browse/${ticket}` : "";
}

function emitProgress(opt, payload) {
  if (!opt?.progress) return;
  try {
    process.stderr.write(`BATCH_MERGE_PROGRESS ${JSON.stringify(payload)}\n`);
  } catch {
    // no-op
  }
}

function reasonDetailFromLabels(mrVersionLabels, jiraVersionLabels) {
  const mr = Array.isArray(mrVersionLabels) ? mrVersionLabels.filter(Boolean) : [];
  const jira = Array.isArray(jiraVersionLabels)
    ? jiraVersionLabels.filter(Boolean)
    : [];
  const mrStr = mr.length ? mr.join("|") : "unknown";
  const jiraStr = jira.length ? jira.join("|") : "unknown";
  return `MR version 與 fix version 不匹配（mr=${mrStr}, jira=${jiraStr}）`;
}

function buildProjectRef(project) {
  if (typeof project === "string" && project.startsWith(":")) {
    return project;
  }
  return encodeURIComponent(String(project || ""));
}

function extractJiraTicketFromMr(mr) {
  const text = `${mr?.title || ""}\n${mr?.description || ""}`;
  const m = text.match(/\b((?:FE|IN)-\d+)\b/);
  return m ? m[1] : "";
}

function normalizeVersionLabel(input) {
  if (!input) return "";
  const m = String(input).match(/\bv?\s*(\d+)\.(\d+)\b/i);
  if (!m) return "";
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return "";
  return `v${major}.${minor}`;
}

function getMrVersionLabels(labels) {
  const out = new Set();
  for (const l of Array.isArray(labels) ? labels : []) {
    const normalized = normalizeVersionLabel(l);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

function getJiraVersionLabelsFromFixVersions(fixVersions) {
  const out = new Set();
  for (const fv of Array.isArray(fixVersions) ? fixVersions : []) {
    const normalized = normalizeVersionLabel(fv?.name);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

function intersects(a, b) {
  const setA = new Set(Array.isArray(a) ? a : []);
  for (const x of Array.isArray(b) ? b : []) {
    if (setA.has(x)) return true;
  }
  return false;
}

async function readJiraFields(ticket) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}?fields=fixVersions`;

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `讀取 Jira 失敗 (${ticket}): ${res.status} ${res.statusText} ${text}`.trim()
    );
  }

  const data = await res.json();
  return {
    fixVersions: data.fields?.fixVersions || [],
  };
}

async function getJiraTransitions(ticket) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/transitions`;

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `讀取 Jira transitions 失敗 (${ticket}): ${res.status} ${res.statusText} ${text}`.trim()
    );
  }

  const data = await res.json();
  return data.transitions || [];
}

async function executeJiraTransition(ticket, transitionId) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}/transitions`;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transition: { id: transitionId } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jira transition 失敗 (${ticket}): ${res.status} ${res.statusText} ${text}`.trim()
    );
  }
}

async function transitionJiraTo(ticket, targetStatus) {
  const transitions = await getJiraTransitions(ticket);
  const lower = String(targetStatus || "").trim().toLowerCase();

  const matched = transitions.find((t) => {
    const name = (t.name || "").toLowerCase();
    const to = (t.to?.name || "").toLowerCase();
    return name === lower || to === lower;
  });

  if (!matched?.id) {
    const available = transitions
      .map((t) => `"${t.name}" (→ ${t.to?.name || "未知"})`)
      .join(", ");
    throw new Error(
      `找不到目標狀態 "${targetStatus}"（${ticket}）。可用轉換: ${available || "無"}`
    );
  }

  await executeJiraTransition(ticket, matched.id);
}

function getApprovalsFlags(approvals, requireUsername) {
  const approvalsLeft = approvals?.approvals_left ?? 999999;
  const approvedBy = approvals?.approved_by || [];
  const fullyApproved = approvalsLeft === 0;
  const userApproved = requireUsername
    ? approvedBy.some((x) => x?.user?.username === requireUsername)
    : true;
  return { fullyApproved, userApproved };
}

async function main() {
  const opt = parseArgs(process.argv);

  const result = {
    options: opt,
    startedAt: new Date().toISOString(),
    iterations: 0,
    processed: 0,
    merged: [],
    conflicts: [],
    skipped: [],
    errors: [],
    finishedAt: null,
  };

  const seen = new Set();
  const projectRef = buildProjectRef(opt.project);

  const jiraCache = new Map();
  async function maybeGetJira(ticket) {
    if (!ticket) return null;
    if (jiraCache.has(ticket)) return jiraCache.get(ticket);
    const data = await readJiraFields(ticket);
    jiraCache.set(ticket, data);
    return data;
  }

  for (let iteration = 1; iteration <= opt.maxIterations; iteration += 1) {
    result.iterations = iteration;

    const endpoint =
      `/projects/${projectRef}` +
      `/merge_requests?state=${encodeURIComponent(opt.state)}` +
      `&labels=${encodeURIComponent(opt.labels)}` +
      `&per_page=${encodeURIComponent(String(opt.perPage))}` +
      `&page=1` +
      `&order_by=${encodeURIComponent(opt.orderBy)}` +
      `&sort=${encodeURIComponent(opt.sort)}`;

    const list = glabApiJson(opt.host, endpoint) || [];
    if (!Array.isArray(list) || list.length === 0) break;

    const newOnes = list.filter((mr) => mr?.iid && !seen.has(mr.iid));
    if (newOnes.length === 0) break;

    for (const mr of newOnes) {
      seen.add(mr.iid);
      if (opt.maxProcess > 0 && result.processed >= opt.maxProcess) break;

      const mrFull =
        glabApiJson(opt.host, `/projects/${projectRef}/merge_requests/${mr.iid}`) ||
        mr;

      const webUrl = mrFull.web_url || mr.web_url || "";
      const title = mrFull.title || mr.title || "";
      const labels = mrFull.labels || [];
      const author = mrFull.author || {};

      const ticket = extractJiraTicketFromMr(mrFull);
      const ticketUrl = jiraUrl(ticket);

      if (opt.skipDraft) {
        const isDraft =
          !!mrFull.draft ||
          (typeof title === "string" && title.toLowerCase().startsWith("draft:"));
        if (isDraft) {
          result.skipped.push({ iid: mrFull.iid, url: webUrl, reason: "DRAFT" });
          emitProgress(opt, {
            status: "skipped",
            reason: "DRAFT",
            reasonDetail: "Draft MR 會被略過",
            project: opt.project,
            iid: mrFull.iid,
            mrUrl: webUrl,
            ticket,
            ticketUrl,
            author: {
              username: author?.username || "",
              name: author?.name || "",
              webUrl: author?.web_url || "",
            },
            jiraFixVersions: [],
          });
          continue;
        }
      }

      const hasConflicts = !!mrFull.has_conflicts;
      const detailed = String(mrFull.detailed_merge_status || "").toLowerCase();
      if (hasConflicts || detailed === "conflict" || detailed === "conflicts") {
        result.conflicts.push({ iid: mrFull.iid, url: webUrl, title });
        emitProgress(opt, {
          status: "conflict",
          reason: "CONFLICT",
          reasonDetail: "MR 有衝突（GitLab 判定 cannot be merged: conflict）",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: [],
        });
        continue;
      }

      if (opt.requireApproved) {
        const approvals =
          glabApiJson(
            opt.host,
            `/projects/${projectRef}/merge_requests/${mrFull.iid}/approvals`
          ) || {};
        const { fullyApproved, userApproved } = getApprovalsFlags(
          approvals,
          opt.requireApprovedBy
        );

        if (!fullyApproved || !userApproved) {
          result.skipped.push({ iid: mrFull.iid, url: webUrl, reason: "NOT_APPROVED" });
          emitProgress(opt, {
            status: "skipped",
            reason: "NOT_APPROVED",
            reasonDetail: "未通過 approval 檢查",
            project: opt.project,
            iid: mrFull.iid,
            mrUrl: webUrl,
            ticket,
            ticketUrl,
            author: {
              username: author?.username || "",
              name: author?.name || "",
              webUrl: author?.web_url || "",
            },
            jiraFixVersions: [],
          });
          continue;
        }
      }

      if (!ticket) {
        result.skipped.push({ iid: mrFull.iid, url: webUrl, reason: "NO_JIRA_TICKET" });
        emitProgress(opt, {
          status: "skipped",
          reason: "NO_JIRA_TICKET",
          reasonDetail: "無法從 MR title/description 抽出 Jira ticket",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket: "",
          ticketUrl: "",
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: [],
        });
        continue;
      }

      let jira;
      try {
        jira = await maybeGetJira(ticket);
      } catch {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `JIRA_READ_FAILED(${ticket})`,
        });
        emitProgress(opt, {
          status: "skipped",
          reason: `JIRA_READ_FAILED(${ticket})`,
          reasonDetail: "讀取 Jira ticket 失敗",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: [],
        });
        continue;
      }

      const mrVersionLabels = getMrVersionLabels(labels);
      if (mrVersionLabels.length === 0) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: "NO_MR_VERSION_LABEL",
        });
        emitProgress(opt, {
          status: "skipped",
          reason: "NO_MR_VERSION_LABEL",
          reasonDetail: "MR 沒有版本標籤（例如 v5.xx）",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: [],
        });
        continue;
      }

      const jiraFixVersionNames = Array.isArray(jira?.fixVersions)
        ? jira.fixVersions.map((x) => x?.name).filter(Boolean)
        : [];
      if (jiraFixVersionNames.length === 0) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `NO_JIRA_FIX_VERSION(${ticket})`,
        });
        emitProgress(opt, {
          status: "skipped",
          reason: `NO_JIRA_FIX_VERSION(${ticket})`,
          reasonDetail: "Jira ticket 沒有填 fixVersion",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: [],
        });
        continue;
      }

      const jiraVersionLabels = getJiraVersionLabelsFromFixVersions(jira.fixVersions);
      if (jiraVersionLabels.length === 0) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `CANNOT_PARSE_JIRA_FIX_VERSION(ticket=${ticket}, fixVersions=${jiraFixVersionNames.join(
            "|"
          )})`,
        });
        emitProgress(opt, {
          status: "skipped",
          reason: `CANNOT_PARSE_JIRA_FIX_VERSION(${ticket})`,
          reasonDetail: "Jira fixVersion 無法解析成 vX.Y 標籤",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: jiraFixVersionNames,
          mrVersionLabels,
          jiraVersionLabels,
        });
        continue;
      }

      if (!intersects(mrVersionLabels, jiraVersionLabels)) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `FIX_VERSION_MISMATCH(expected=${jiraVersionLabels.join(
            "|"
          )}, actual=${mrVersionLabels.join("|")}, ticket=${ticket})`,
        });
        emitProgress(opt, {
          status: "skipped",
          reason: "FIX_VERSION_MISMATCH",
          reasonDetail: reasonDetailFromLabels(mrVersionLabels, jiraVersionLabels),
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: jiraFixVersionNames,
          mrVersionLabels,
          jiraVersionLabels,
        });
        continue;
      }

      result.processed += 1;

      if (opt.dryRun) {
        result.merged.push({ iid: mrFull.iid, url: webUrl, ticket, dryRun: true });
        emitProgress(opt, {
          status: "dry_run_candidate",
          reason: "DRY_RUN_CANDIDATE",
          reasonDetail: "符合條件（dry-run 候選）",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: jiraFixVersionNames,
          mrVersionLabels,
          jiraVersionLabels,
        });
        continue;
      }

      if (opt.mergeDelaySeconds > 0) await sleep(opt.mergeDelaySeconds * 1000);

      try {
        glabApiPutJson(
          opt.host,
          `/projects/${projectRef}/merge_requests/${mrFull.iid}/merge`
        );
      } catch (e) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `MERGE_FAILED(${String(e.message || e)})`,
        });
        emitProgress(opt, {
          status: "merge_failed",
          reason: `MERGE_FAILED(${String(e.message || e)})`,
          reasonDetail: "GitLab 合併 API 呼叫失敗",
          project: opt.project,
          iid: mrFull.iid,
          mrUrl: webUrl,
          ticket,
          ticketUrl,
          author: {
            username: author?.username || "",
            name: author?.name || "",
            webUrl: author?.web_url || "",
          },
          jiraFixVersions: jiraFixVersionNames,
          mrVersionLabels,
          jiraVersionLabels,
        });
        continue;
      }

      let jiraTransition = "skipped";
      if (opt.transitionJira) {
        try {
          await transitionJiraTo(ticket, opt.jiraTargetStatus);
          jiraTransition = "success";
        } catch (e) {
          jiraTransition = "failed";
          result.errors.push({
            iid: mrFull.iid,
            url: webUrl,
            ticket,
            error: `JIRA_TRANSITION_FAILED(${String(e.message || e)})`,
          });
        }
      }

      result.merged.push({ iid: mrFull.iid, url: webUrl, ticket });
      emitProgress(opt, {
        status: "merged",
        reason: "MERGED",
        reasonDetail: "合併成功",
        project: opt.project,
        iid: mrFull.iid,
        mrUrl: webUrl,
        ticket,
        ticketUrl,
        author: {
          username: author?.username || "",
          name: author?.name || "",
          webUrl: author?.web_url || "",
        },
        jiraFixVersions: jiraFixVersionNames,
        mrVersionLabels,
        jiraVersionLabels,
        jiraTransition,
        jiraTargetStatus: opt.jiraTargetStatus,
      });
    }

    if (opt.maxProcess > 0 && result.processed >= opt.maxProcess) break;
  }

  result.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message || e) }, null, 2));
  process.exit(1);
});


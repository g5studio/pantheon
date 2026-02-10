#!/usr/bin/env node

/**
 * 批次處理 Merge Requests：
 * - 檢查衝突
 * - 檢查 version label 與 Jira 主單版本是否相符（由 Jira summary 推導 3.0/4.0）
 * - 檢查 approvals（可要求特定使用者必須在 approved_by 中）
 * - 符合條件才合併，並將 Jira 狀態切到指定狀態（預設 PENDING DEPLOY STG）
 *
 * 特色：
 * - 每次只取 100 筆（GitLab per_page 上限通常為 100）
 * - 每筆合併前 sleep 1.5s（可調整），避免 GitLab 瞬間壓力過大
 * - 允許自訂參數：labels/state/orderBy/sort/perPage/delay/jiraStatus/approvedBy/dryRun/maxIterations
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
    '  node .cursor/scripts/admin/batch-merge-mrs.mjs --labels=v5.38 --approved-by=william.chiang --jira-to="PENDING DEPLOY STG" --dry-run',
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
    dryRun: false,
    // loop guard: when list keeps changing
    maxIterations: 1000,
    // optional upper bound of how many MRs to *attempt* (after filtering)
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

    if (arg === "--dry-run") {
      opt.dryRun = true;
      provided.action = "dry-run";
      continue;
    }
    if (arg === "--execute") {
      // Explicitly allow real merges (dryRun stays false).
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
  if (opt.perPage > 100) opt.perPage = 100; // GitLab 通常上限 100

  if (!Number.isFinite(opt.mergeDelaySeconds) || opt.mergeDelaySeconds < 0) {
    opt.mergeDelaySeconds = 1.5;
  }

  if (!Number.isFinite(opt.maxIterations) || opt.maxIterations <= 0) {
    opt.maxIterations = 1000;
  }
  if (!Number.isFinite(opt.maxProcess) || opt.maxProcess < 0) {
    opt.maxProcess = 0;
  }

  // Strict validation to prevent accidental merges/transitions.
  if (args.length === 0) {
    throw new Error(usage());
  }
  if (unknown.length > 0) {
    throw new Error([`Unknown flags: ${unknown.join(", ")}`, "", usage()].join("\n"));
  }
  if (!provided.hasLabels) {
    throw new Error(usage());
  }
  if (!provided.hasApprovalChoice) {
    throw new Error(usage());
  }
  if (!provided.hasJiraChoice) {
    throw new Error(usage());
  }
  if (!provided.action) {
    throw new Error(usage());
  }
  if (provided.action === "dry-run") {
    opt.dryRun = true;
  }

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

  if (res.error) {
    throw new Error(`glab 執行失敗: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`glab 退出碼 ${res.status}: ${stderr || stdout}`.trim());
  }
  return stdout.trim();
}

function glabApiJson(host, endpoint) {
  const out = execGlab(host, ["api", endpoint], { silent: true });
  return out ? JSON.parse(out) : null;
}

function buildProjectRef(project) {
  // 支援 glab placeholder（例如 :id），此時不可 encode
  if (typeof project === "string" && project.startsWith(":")) {
    return project;
  }
  return encodeURIComponent(String(project || ""));
}

function extractJiraTicketFromMr(mr) {
  const text = `${mr?.title || ""}\n${mr?.description || ""}`;
  const m = text.match(/\b(IN-\d+)\b/);
  return m ? m[1] : "";
}

function expectedUiLabelFromJiraSummary(summary) {
  if (!summary) return "";
  const m = summary.match(/\[\s*([34])\.0\s*\]/);
  if (m?.[1] === "3") return "3.0UI";
  if (m?.[1] === "4") return "4.0UI";
  if (/\b4\.0\b/.test(summary)) return "4.0UI";
  if (/\b3\.0\b/.test(summary)) return "3.0UI";
  return "";
}

async function readJiraSummary(ticket) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
  const baseUrl = config.baseUrl.endsWith("/")
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const apiUrl = `${baseUrl}/rest/api/3/issue/${ticket}?fields=summary,status`;

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
    summary: data.fields?.summary || "",
    status: data.fields?.status?.name || "",
  };
}

async function getJiraTransitions(ticket) {
  const config = getJiraConfig();
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
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
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    "base64"
  );
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
  const lower = targetStatus.toLowerCase();

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
    if (!Array.isArray(list) || list.length === 0) {
      break;
    }

    const newOnes = list.filter((mr) => mr?.iid && !seen.has(mr.iid));
    if (newOnes.length === 0) {
      // 避免 list 不變造成無限迴圈
      break;
    }

    for (const mr of newOnes) {
      seen.add(mr.iid);

      if (opt.maxProcess > 0 && result.processed >= opt.maxProcess) {
        break;
      }

      // fetch full mr details for conflicts/labels/description
      const mrFull =
        glabApiJson(
          opt.host,
          `/projects/${projectRef}/merge_requests/${mr.iid}`
        ) || mr;

      const webUrl = mrFull.web_url || mr.web_url || "";
      const title = mrFull.title || mr.title || "";
      const labels = mrFull.labels || [];

      if (opt.skipDraft) {
        const isDraft =
          !!mrFull.draft ||
          (typeof title === "string" && title.toLowerCase().startsWith("draft:"));
        if (isDraft) {
          result.skipped.push({
            iid: mrFull.iid,
            url: webUrl,
            reason: "DRAFT",
          });
          continue;
        }
      }

      const hasConflicts = !!mrFull.has_conflicts;
      const detailed = mrFull.detailed_merge_status || "";
      if (hasConflicts || detailed === "conflicts") {
        result.conflicts.push({ iid: mrFull.iid, url: webUrl, title });
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
          result.skipped.push({
            iid: mrFull.iid,
            url: webUrl,
            reason: "NOT_APPROVED",
          });
          continue;
        }
      }

      // version label check vs Jira
      const ticket = extractJiraTicketFromMr(mrFull);
      if (!ticket) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: "NO_JIRA_TICKET",
        });
        continue;
      }

      let jira;
      try {
        jira = await readJiraSummary(ticket);
      } catch {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `JIRA_READ_FAILED(${ticket})`,
        });
        continue;
      }

      const expected = expectedUiLabelFromJiraSummary(jira.summary);
      if (!expected) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `CANNOT_DETERMINE_VERSION(${ticket})`,
        });
        continue;
      }

      if (!labels.includes(expected)) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `LABEL_MISMATCH(expected=${expected}, actual=${labels.join(
            "|"
          )}, ticket=${ticket})`,
        });
        continue;
      }

      result.processed += 1;

      if (opt.dryRun) {
        result.merged.push({
          iid: mrFull.iid,
          url: webUrl,
          ticket,
          dryRun: true,
        });
        continue;
      }

      // merge delay
      if (opt.mergeDelaySeconds > 0) {
        await sleep(opt.mergeDelaySeconds * 1000);
      }

      try {
        execGlab(opt.host, ["mr", "merge", String(mrFull.iid), "--yes"], {
          silent: true,
        });
      } catch (e) {
        result.skipped.push({
          iid: mrFull.iid,
          url: webUrl,
          reason: `MERGE_FAILED(${String(e.message || e)})`,
        });
        continue;
      }

      // transition jira
      if (opt.transitionJira) {
        try {
          await transitionJiraTo(ticket, opt.jiraTargetStatus);
        } catch (e) {
          // 合併已完成，Jira 失敗只記錄錯誤
          result.errors.push({
            iid: mrFull.iid,
            url: webUrl,
            ticket,
            error: `JIRA_TRANSITION_FAILED(${String(e.message || e)})`,
          });
        }
      }

      result.merged.push({ iid: mrFull.iid, url: webUrl, ticket });
    }

    if (opt.maxProcess > 0 && result.processed >= opt.maxProcess) {
      break;
    }
  }

  result.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message || e) }, null, 2));
  process.exit(1);
});


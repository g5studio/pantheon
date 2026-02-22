#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getProjectRoot } from "../utilities/env-loader.mjs";

const projectRoot = getProjectRoot();

const LEGACY_REPORT_JSON_FILENAME = "development-report.json";
const LEGACY_PLAN_JSON_FILENAME = "development-plan.json";
const MR_DESCRIPTION_INFO_JSON_FILENAME = "merge-request-description-info.json";

export const DEVELOPMENT_REPORT_JSON_EMBED_START =
  "<!-- PANTHEON_DEVELOPMENT_REPORT_JSON_START";
export const DEVELOPMENT_REPORT_JSON_EMBED_END =
  "PANTHEON_DEVELOPMENT_REPORT_JSON_END -->";

export const MR_DESCRIPTION_INFO_JSON_EMBED_START =
  "<!-- PANTHEON_MR_DESCRIPTION_INFO_JSON_START";
export const MR_DESCRIPTION_INFO_JSON_EMBED_END =
  "PANTHEON_MR_DESCRIPTION_INFO_JSON_END -->";

function normalizeLf(text) {
  return typeof text === "string" ? text.replace(/\r\n/g, "\n") : "";
}

export function getTmpDirForTicket(ticket) {
  if (!ticket || typeof ticket !== "string") return null;
  return join(projectRoot, ".cursor", "tmp", ticket);
}

export function getDevelopmentReportJsonPath(ticket) {
  const dir = getTmpDirForTicket(ticket);
  if (!dir) return null;
  return join(dir, LEGACY_REPORT_JSON_FILENAME);
}

export function getDevelopmentPlanJsonPath(ticket) {
  const dir = getTmpDirForTicket(ticket);
  if (!dir) return null;
  return join(dir, LEGACY_PLAN_JSON_FILENAME);
}

export function getMergeRequestDescriptionInfoJsonPath(ticket) {
  const dir = getTmpDirForTicket(ticket);
  if (!dir) return null;
  return join(dir, MR_DESCRIPTION_INFO_JSON_FILENAME);
}

export function ensureTmpDir(ticket) {
  const dir = getTmpDirForTicket(ticket);
  if (!dir) return null;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeTmpDirForTicket(ticket) {
  if (!ticket || typeof ticket !== "string") return false;
  if (!/^[A-Z0-9]+-\d+$/.test(ticket)) return false;

  const dir = getTmpDirForTicket(ticket);
  if (!dir) return false;

  const expectedPrefix = join(projectRoot, ".cursor", "tmp") + "/";
  const normalizedDir = dir.replaceAll("\\", "/");
  if (!normalizedDir.replaceAll("\\", "/").startsWith(expectedPrefix)) {
    return false;
  }

  if (!existsSync(dir)) return true;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function readJsonIfExists(absPath) {
  if (!absPath || typeof absPath !== "string") return null;
  if (!existsSync(absPath)) return null;
  const raw = normalizeLf(readFileSync(absPath, "utf-8")).replace(/^\uFEFF/, "");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

export function writeJsonFile(absPath, data) {
  if (!absPath || typeof absPath !== "string") {
    throw new Error("writeJsonFile: invalid path");
  }
  const content = `${JSON.stringify(data ?? null, null, 2)}\n`;
  writeFileSync(absPath, content, "utf-8");
}

export function toJiraTicketUrl(ticket) {
  if (!ticket || typeof ticket !== "string") return null;
  return `https://innotech.atlassian.net/browse/${ticket}`;
}

function hasAnyText(value) {
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
}

function isNonEmptyObject(obj) {
  return !!obj && typeof obj === "object" && !Array.isArray(obj);
}

export function createDefaultMergeRequestDescriptionInfoJson({
  ticket,
  jiraTicketUrl,
  plan,
  report,
} = {}) {
  const t = ticket || "N/A";
  const url = jiraTicketUrl || (t !== "N/A" ? toJiraTicketUrl(t) : null);

  return {
    schemaVersion: 1,
    ticket: t,
    jiraTicketUrl: url,
    plan: {
      jiraTicketUrl: url,
      target: "",
      scope: "",
      test: "",
      ...(isNonEmptyObject(plan) ? plan : {}),
    },
    report: isNonEmptyObject(report) ? report : null,
  };
}

export function normalizeMergeRequestDescriptionInfoJson(infoJson, { changeFiles } = {}) {
  const base = isNonEmptyObject(infoJson) ? infoJson : {};
  const ticket = base.ticket || "N/A";
  const jiraTicketUrl =
    base.jiraTicketUrl || (ticket !== "N/A" ? toJiraTicketUrl(ticket) : null);

  const planBase = isNonEmptyObject(base.plan) ? base.plan : {};
  const normalizedPlan = {
    jiraTicketUrl: planBase.jiraTicketUrl || jiraTicketUrl,
    target: planBase.target || "",
    scope: planBase.scope || "",
    test: planBase.test || "",
  };

  const reportBase = isNonEmptyObject(base.report) ? base.report : null;
  const normalizedReport = reportBase
    ? normalizeDevelopmentReportJson(reportBase, { changeFiles })
    : null;

  return {
    schemaVersion: 1,
    ticket,
    jiraTicketUrl,
    plan: normalizedPlan,
    report: normalizedReport,
  };
}

function escapeTableCell(text) {
  const s = typeof text === "string" ? text : "";
  return s.replaceAll("|", "\\|").replace(/\r?\n/g, " ").trim();
}

function formatFilePathForTable(path) {
  if (!path || typeof path !== "string") return "";
  return `\`${path}\``;
}

function statusToChinese(status) {
  switch (status) {
    case "A":
    case "新增":
      return "新增";
    case "M":
    case "更新":
      return "更新";
    case "D":
    case "刪除":
      return "刪除";
    case "R":
    case "重命名":
      return "重命名";
    default:
      return status || "更新";
  }
}

export function createDefaultDevelopmentReportJson({
  ticket,
  jiraTitle,
  issueType,
  changeFiles = [],
} = {}) {
  const jiraTicketUrl = ticket ? toJiraTicketUrl(ticket) : null;

  return {
    schemaVersion: 1,
    ticket: ticket || "N/A",
    jiraTicketUrl,
    title: jiraTitle || "",
    issueType: issueType || "",
    changeSummary: "",
    changes: {
      files: Array.isArray(changeFiles)
        ? changeFiles.map((f) => ({
            path: f?.path || "",
            status: statusToChinese(f?.status),
            description: f?.description || "",
          }))
        : [],
    },
    riskAssessment: {
      files: Array.isArray(changeFiles)
        ? changeFiles.map((f) => ({
            path: f?.path || "",
            level: "中度",
            reason: "待補齊",
          }))
        : [],
    },
    bug: {
      impactScope: "",
      rootCause: "",
      // 保留擴充空間（例如「造成問題的單號」）
      regressionSource: null,
    },
    request: {
      expectedResult: "",
    },
  };
}

export function embedDevelopmentReportJsonAsHiddenBlock(reportJson) {
  const json = JSON.stringify(reportJson ?? null, null, 2);
  return `${DEVELOPMENT_REPORT_JSON_EMBED_START}\n${json}\n${DEVELOPMENT_REPORT_JSON_EMBED_END}`;
}

export function embedMergeRequestDescriptionInfoJsonAsHiddenBlock(infoJson) {
  const json = JSON.stringify(infoJson ?? null, null, 2);
  return `${MR_DESCRIPTION_INFO_JSON_EMBED_START}\n${json}\n${MR_DESCRIPTION_INFO_JSON_EMBED_END}`;
}

export function extractEmbeddedDevelopmentReportJson(description) {
  const text = normalizeLf(description);
  const startIdx = text.indexOf(DEVELOPMENT_REPORT_JSON_EMBED_START);
  const endIdx = text.indexOf(DEVELOPMENT_REPORT_JSON_EMBED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const jsonStart = startIdx + DEVELOPMENT_REPORT_JSON_EMBED_START.length;
  const jsonRaw = text.slice(jsonStart, endIdx).trim();
  if (!jsonRaw) return null;
  try {
    return JSON.parse(jsonRaw);
  } catch {
    return null;
  }
}

export function extractEmbeddedMergeRequestDescriptionInfoJson(description) {
  const text = normalizeLf(description);
  const startIdx = text.indexOf(MR_DESCRIPTION_INFO_JSON_EMBED_START);
  const endIdx = text.indexOf(MR_DESCRIPTION_INFO_JSON_EMBED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const jsonStart = startIdx + MR_DESCRIPTION_INFO_JSON_EMBED_START.length;
  const jsonRaw = text.slice(jsonStart, endIdx).trim();
  if (!jsonRaw) return null;
  try {
    return JSON.parse(jsonRaw);
  } catch {
    return null;
  }
}

function parseMarkdownTable(markdown, headerLine) {
  const text = normalizeLf(markdown);
  const headerIdx = text.indexOf(headerLine);
  if (headerIdx === -1) return [];

  const after = text.slice(headerIdx);
  const lines = after.split("\n");
  const headerLineIdx = lines.findIndex((l) => l.trim() === headerLine.trim());
  if (headerLineIdx === -1) return [];

  const rows = [];
  for (let i = headerLineIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    if (line.includes("|---")) continue;
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, idx, arr) => !(idx === 0 || idx === arr.length - 1));
    if (cols.length === 0) continue;
    rows.push(cols);
  }
  return rows;
}

function extractSectionText(markdown, heading) {
  const text = normalizeLf(markdown);
  const idx = text.indexOf(heading);
  if (idx === -1) return "";
  const after = text.slice(idx + heading.length);
  const nextHeadingIdx = after.search(/\n##\s+/);
  const raw = nextHeadingIdx === -1 ? after : after.slice(0, nextHeadingIdx);
  return raw.trim();
}

function stripBackticks(s) {
  const text = typeof s === "string" ? s.trim() : "";
  if (text.startsWith("`") && text.endsWith("`")) return text.slice(1, -1);
  return text;
}

export function parseDevelopmentReportMarkdownToJson(markdown, fallbackTicket) {
  const relatedRows = parseMarkdownTable(markdown, "| 項目 | 值 |");
  const relatedMap = new Map();
  for (const [k, v] of relatedRows) {
    relatedMap.set(k, v);
  }
  const ticketCell = relatedMap.get("**單號**") || "";
  const ticketMatch = ticketCell.match(/\[([A-Z0-9]+-\d+)\]\(([^)]+)\)/);
  const ticket = ticketMatch?.[1] || fallbackTicket || "N/A";
  const jiraTicketUrl = ticketMatch?.[2] || (ticket !== "N/A" ? toJiraTicketUrl(ticket) : null);

  const titleCell = relatedMap.get("**標題**") || "";
  const issueTypeCell = relatedMap.get("**類型**") || "";

  const changeSummary = extractSectionText(markdown, "## 📝 變更摘要");
  const changeFilesRows = parseMarkdownTable(markdown, "| 檔案 | 狀態 | 說明 |");
  const riskRows = parseMarkdownTable(markdown, "| 檔案 | 風險等級 | 評估說明 |");

  const files = changeFilesRows.map(([file, status, desc]) => ({
    path: stripBackticks(file),
    status: status || "更新",
    description: desc || "",
  }));

  const risks = riskRows.map(([file, level, reason]) => ({
    path: stripBackticks(file),
    level: level || "中度",
    reason: reason || "",
  }));

  const impactScope = extractSectionText(markdown, "## 影響範圍");
  const rootCause = extractSectionText(markdown, "## 根本原因");
  const expectedResult = extractSectionText(markdown, "## 預期效果");

  return {
    schemaVersion: 1,
    ticket,
    jiraTicketUrl,
    title: titleCell,
    issueType: issueTypeCell,
    changeSummary,
    changes: { files },
    riskAssessment: { files: risks },
    bug: { impactScope, rootCause, regressionSource: null },
    request: { expectedResult },
  };
}

export function normalizeDevelopmentReportJson(reportJson, { changeFiles } = {}) {
  const base = typeof reportJson === "object" && reportJson ? reportJson : {};
  const ticket = base.ticket || "N/A";

  const files = Array.isArray(base?.changes?.files) ? base.changes.files : [];
  const riskFiles = Array.isArray(base?.riskAssessment?.files)
    ? base.riskAssessment.files
    : [];

  const changePaths = new Set(
    (Array.isArray(changeFiles) ? changeFiles : files)
      .map((f) => f?.path)
      .filter(Boolean)
  );

  const normalizedChangeFiles = (Array.isArray(changeFiles) ? changeFiles : files).map(
    (f) => ({
      path: f?.path || "",
      status: statusToChinese(f?.status),
      description: f?.description || "",
    })
  );

  const riskByPath = new Map(
    riskFiles
      .filter((r) => r && typeof r === "object" && r.path)
      .map((r) => [
        r.path,
        { path: r.path, level: r.level || "中度", reason: r.reason || "待補齊" },
      ])
  );

  const normalizedRiskFiles = Array.from(changePaths).map((path) => {
    return riskByPath.get(path) || { path, level: "中度", reason: "待補齊" };
  });

  return {
    schemaVersion: 1,
    ticket,
    jiraTicketUrl:
      base.jiraTicketUrl || (ticket !== "N/A" ? toJiraTicketUrl(ticket) : null),
    title: base.title || "",
    issueType: base.issueType || "",
    changeSummary: base.changeSummary || "",
    changes: { files: normalizedChangeFiles },
    riskAssessment: { files: normalizedRiskFiles },
    bug: {
      impactScope: base?.bug?.impactScope || "",
      rootCause: base?.bug?.rootCause || "",
      regressionSource: base?.bug?.regressionSource ?? null,
    },
    request: {
      expectedResult: base?.request?.expectedResult || "",
    },
  };
}

export function renderDevelopmentReportMarkdown(reportJson) {
  const r = normalizeDevelopmentReportJson(reportJson);

  const ticket = r.ticket && r.ticket !== "N/A" ? r.ticket : null;
  const jiraUrl = r.jiraTicketUrl || (ticket ? toJiraTicketUrl(ticket) : null);
  const ticketCell =
    ticket && jiraUrl ? `[${ticket}](${jiraUrl})` : (ticket || "N/A");

  const title = escapeTableCell(r.title || "");
  const issueType = escapeTableCell(r.issueType || "");

  const summary = (r.changeSummary || "").trim() || "待補齊";

  const changeRows =
    r?.changes?.files?.length > 0
      ? r.changes.files
      : [{ path: "", status: "更新", description: "待補齊" }];

  const riskRows =
    r?.riskAssessment?.files?.length > 0
      ? r.riskAssessment.files
      : [{ path: "", level: "中度", reason: "待補齊" }];

  const lines = [];

  lines.push("## 📋 關聯單資訊", "");
  lines.push("| 項目 | 值 |");
  lines.push("|---|---|");
  lines.push(`| **單號** | ${ticketCell} |`);
  lines.push(`| **標題** | ${title || "待補齊"} |`);
  lines.push(`| **類型** | ${issueType || "待補齊"} |`);
  lines.push("", "---", "");

  lines.push("## 📝 變更摘要", "", summary, "", "### 變更內容", "");
  lines.push("| 檔案 | 狀態 | 說明 |");
  lines.push("|---|---|---|");
  for (const f of changeRows) {
    lines.push(
      `| ${formatFilePathForTable(f.path)} | ${escapeTableCell(
        statusToChinese(f.status)
      )} | ${escapeTableCell(f.description || "待補齊")} |`
    );
  }
  lines.push("", "---", "");

  lines.push("## ⚠️ 風險評估", "");
  lines.push("| 檔案 | 風險等級 | 評估說明 |");
  lines.push("|---|---|---|");
  for (const rf of riskRows) {
    lines.push(
      `| ${formatFilePathForTable(rf.path)} | ${escapeTableCell(
        rf.level || "中度"
      )} | ${escapeTableCell(rf.reason || "待補齊")} |`
    );
  }

  const isBug =
    typeof r.issueType === "string" && r.issueType.toLowerCase().includes("bug");
  if (isBug) {
    lines.push("", "## 影響範圍", "", (r?.bug?.impactScope || "").trim() || "待補齊");
    lines.push("", "## 根本原因", "", (r?.bug?.rootCause || "").trim() || "待補齊");
  }

  const expected = (r?.request?.expectedResult || "").trim();
  if (expected) {
    lines.push("", "## 預期效果", "", expected);
  }

  lines.push("", embedDevelopmentReportJsonAsHiddenBlock(r));

  return lines.join("\n").trim() + "\n";
}

function renderPlanSection(plan) {
  const p = isNonEmptyObject(plan) ? plan : {};
  const hasContent =
    hasAnyText(p.target) || hasAnyText(p.scope) || hasAnyText(p.test);
  if (!hasContent) return null;

  const lines = [];
  lines.push("## 🎯 開發計劃", "");
  lines.push("| 項目 | 內容 |");
  lines.push("|---|---|");
  lines.push(`| **目標 (target)** | ${escapeTableCell(p.target || "待補齊")} |`);
  lines.push(`| **改動範圍 (scope)** | ${escapeTableCell(p.scope || "待補齊")} |`);
  lines.push(`| **驗收項目 (test)** | ${escapeTableCell(p.test || "待補齊")} |`);
  return lines.join("\n").trim();
}

export function renderMergeRequestDescriptionInfoMarkdown(infoJson, { changeFiles } = {}) {
  const info = normalizeMergeRequestDescriptionInfoJson(infoJson, { changeFiles });

  const blocks = [];
  const planBlock = renderPlanSection(info.plan);
  if (planBlock) blocks.push(planBlock);

  if (info.report) {
    blocks.push(renderDevelopmentReportMarkdown(info.report).trim());
  }

  if (blocks.length === 0) return "";

  const merged = `${blocks.join("\n\n")}\n\n${embedMergeRequestDescriptionInfoJsonAsHiddenBlock(
    info
  )}\n`;
  return merged.trim() + "\n";
}


#!/usr/bin/env node

/**
 * adapt - repo knowledge bootstrapper
 *
 * - Collect GitLab labels and merge requests within last 3 months (by created_at)
 * - Compress MR data into fixed array format:
 *   { label: 123, changes: "...", comments: [{ message: "xxx", line: 13 }, ...] }[]
 * - Send to LLM for analysis and persist output into JSON:
 *   { labels: [{name,scenario}], "coding-standard": [{rule,example}], ...meta/cache/sources }
 * - Cache: skip LLM when inputs hash unchanged
 */

import { execSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getProjectRoot, loadEnvLocal, getGitLabToken } from "./env-loader.mjs";
import { callOpenAiJson, resolveLlmModel } from "./llm-client.mjs";

const projectRoot = getProjectRoot();

function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    if (!raw) continue;
    if (!raw.startsWith("--")) {
      args._.push(raw);
      continue;
    }
    const [k, ...vParts] = raw.slice(2).split("=");
    const v = vParts.length ? vParts.join("=") : true;
    args[k] = v;
  }
  return args;
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    }).trim();
  } catch (e) {
    if (options.throwOnError === false) return null;
    throw e;
  }
}

function hasGlab() {
  try {
    exec("which glab", { silent: true });
    return true;
  } catch {
    return false;
  }
}

function isGlabAuthenticated(hostname) {
  try {
    const result = exec(`glab auth status --hostname ${hostname}`, {
      silent: true,
      throwOnError: false,
    });
    return !!result && (result.includes("authenticated") || result.includes("✓"));
  } catch {
    return false;
  }
}

function glabApi(path) {
  const result = exec(`glab api "${path}"`, { silent: true });
  if (!result) return null;
  return JSON.parse(result);
}

function ensureDirForFile(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getDefaultKnowledgeFile() {
  return join(projectRoot, "adapt.json");
}

function safeJsonParse(text, hint = "JSON") {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${hint} 解析失敗：${e.message}`);
  }
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function validateLabelsSection(value) {
  if (!Array.isArray(value)) return { ok: false, error: "labels 必須是 array" };
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isPlainObject(item)) return { ok: false, error: `labels[${i}] 必須是 object` };
    if (typeof item.name !== "string" || !item.name.trim()) {
      return { ok: false, error: `labels[${i}].name 必須是非空字串` };
    }
    // Backward-compatible:
    // - allow missing `applicable`
    // - allow legacy boolean `applicable`
    // - new schema: applicable: { ok: boolean, reason: string }
    if ("applicable" in item) {
      const a = item.applicable;
      if (typeof a === "boolean") {
        // legacy ok
      } else if (isPlainObject(a)) {
        if (typeof a.ok !== "boolean") {
          return { ok: false, error: `labels[${i}].applicable.ok 必須是 boolean` };
        }
        if (typeof a.reason !== "string" || !a.reason.trim()) {
          return { ok: false, error: `labels[${i}].applicable.reason 必須是非空字串` };
        }
      } else {
        return {
          ok: false,
          error: `labels[${i}].applicable 必須是 boolean 或 {ok,reason}`,
        };
      }
    }
    if (typeof item.scenario !== "string" || !item.scenario.trim()) {
      return { ok: false, error: `labels[${i}].scenario 必須是非空字串` };
    }
  }
  return { ok: true };
}

/**
 * Infer a minimal git-flow object from collected git data (no LLM).
 * Used when --no-llm or when no API key.
 */
function inferGitFlowFromData(gitFlowData) {
  if (!gitFlowData || !gitFlowData.branches?.remote?.length) return null;

  const defaultBranch = gitFlowData.remoteHead || "main";
  const hasRelease = (gitFlowData.branchNamePatterns?.release?.length ?? 0) > 0;
  const hasDev = gitFlowData.branches.remote.some((b) => b === "dev");
  const hasMain = gitFlowData.branches.remote.some((b) => b === "main");

  const branches = [];
  if (hasMain) branches.push({ name: "main", role: "生產主線", description: "接收 release 分支合併，對應生產環境" });
  if (hasDev) branches.push({ name: "dev", role: "開發整合主線", description: "預設分支，接收 feature/fix 與 release 分支合併" });
  if (hasRelease) {
    const samples = (gitFlowData.branchNamePatterns?.release ?? []).slice(0, 3);
    branches.push({
      name: "release/X.Y.Z",
      role: "版本 release 分支",
      description: `範例：${samples.join(", ")}。接收該版本的 fix/feat 合併後再合併回 dev` + (hasMain ? " 或 main" : ""),
    });
  }
  const featSamples = (gitFlowData.branchNamePatterns?.feat ?? []).slice(0, 3);
  const fixSamples = (gitFlowData.branchNamePatterns?.fix ?? []).slice(0, 3);
  if (featSamples.length || fixSamples.length) {
    branches.push({
      name: "feat/|fix/",
      role: "短期功能/修復分支",
      description: `範例：${[...featSamples, ...fixSamples].filter(Boolean).slice(0, 3).join(", ")}。依 ticket 開發後合併至 dev 或 release`,
    });
  }

  const flowType = hasRelease && (hasDev || hasMain)
    ? "Git Flow 變體（含 release 分支）"
    : hasDev && hasMain
      ? "Git Flow"
      : "Trunk-based 或簡化分支";

  const mergeFlow = hasRelease
    ? `feat/fix → release/X.Y.Z → ${hasDev ? "dev" : ""}${hasDev && hasMain ? "；release → main" : ""}`
    : hasDev
      ? "feat/fix → dev"
      : "feat/fix → main";

  const examples = [
    ...(gitFlowData.branchNamePatterns?.feat ?? []).slice(0, 2),
    ...(gitFlowData.branchNamePatterns?.fix ?? []).slice(0, 2),
  ].filter(Boolean);

  return {
    flowType,
    defaultBranch,
    summary: `預設分支為 ${defaultBranch}。${hasRelease ? "有 release 分支管理版本。" : ""}${hasDev ? "dev 為開發整合主線。" : ""}分支命名格式為 type/TICKET。`,
    branches,
    mergeFlow,
    branchNaming: { format: "type/TICKET", examples: examples.length ? examples : ["feat/OPR-1234", "fix/IN-113575"] },
    mrTargets: [...new Set([hasDev && "dev", hasRelease && "release/X.Y.Z", hasMain && "main"].filter(Boolean))],
  };
}

function validateGitFlowSection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "git-flow 必須是 object" };
  }
  if (typeof value.flowType !== "string" || !value.flowType.trim()) {
    return { ok: false, error: "git-flow.flowType 必須是非空字串" };
  }
  if (typeof value.defaultBranch !== "string" || !value.defaultBranch.trim()) {
    return { ok: false, error: "git-flow.defaultBranch 必須是非空字串" };
  }
  if (typeof value.summary !== "string" || !value.summary.trim()) {
    return { ok: false, error: "git-flow.summary 必須是非空字串" };
  }
  return { ok: true };
}

function validateCodingStandardSection(value) {
  if (!Array.isArray(value)) return { ok: false, error: "coding-standard 必須是 array" };
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isPlainObject(item)) {
      return { ok: false, error: `coding-standard[${i}] 必須是 object` };
    }
    if (typeof item.rule !== "string" || !item.rule.trim()) {
      return { ok: false, error: `coding-standard[${i}].rule 必須是非空字串` };
    }
    if (typeof item.example !== "string" || !item.example.trim()) {
      return { ok: false, error: `coding-standard[${i}].example 必須是非空字串` };
    }
  }
  return { ok: true };
}

function normalizeApplicable(value) {
  if (typeof value === "boolean") {
    return {
      ok: value,
      reason: value ? "（由 LLM 判定為適用）" : "（由 LLM 判定為不適用）",
    };
  }
  if (isPlainObject(value) && typeof value.ok === "boolean") {
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    if (reason) return { ok: value.ok, reason };
  }
  return null;
}

function normalizeLabelItem(item) {
  if (!isPlainObject(item)) return { ok: false, error: "item 必須是 object" };
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) return { ok: false, error: "name 必須是非空字串" };
  const applicable = normalizeApplicable(item.applicable);
  if (!applicable) {
    return {
      ok: false,
      error: "applicable 必須是 boolean 或 { ok: boolean, reason: string }",
    };
  }
  const scenario = typeof item.scenario === "string" ? item.scenario.trim() : "";
  if (!scenario) return { ok: false, error: "scenario 必須是非空字串" };
  return {
    ok: true,
    value: {
      name,
      applicable,
      scenario,
    },
  };
}

function validateRepoKnowledgeObject(obj) {
  if (!isPlainObject(obj)) return { ok: false, error: "根節點必須是 object" };
  if (!("labels" in obj)) return { ok: false, error: "缺少 labels" };
  if (!("coding-standard" in obj)) return { ok: false, error: "缺少 coding-standard" };
  const a = validateLabelsSection(obj.labels);
  if (!a.ok) return a;
  const b = validateCodingStandardSection(obj["coding-standard"]);
  if (!b.ok) return b;
  for (const k of ["meta", "sources", "cache"]) {
    if (k in obj && obj[k] !== null && !isPlainObject(obj[k])) {
      return { ok: false, error: `${k} 必須是 object（或省略）` };
    }
  }
  if ("git-flow" in obj && obj["git-flow"] != null) {
    const gf = validateGitFlowSection(obj["git-flow"]);
    if (!gf.ok) return gf;
  }
  return { ok: true };
}

function readKnowledgeIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const obj = safeJsonParse(text, "repo knowledge JSON");
  const check = validateRepoKnowledgeObject(obj);
  if (!check.ok) throw new Error(`既有 JSON schema 驗證失敗：${check.error}`);
  return obj;
}

function writeKnowledge(filePath, obj) {
  const check = validateRepoKnowledgeObject(obj);
  if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
  ensureDirForFile(filePath);
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function getProjectInfo() {
  const remoteUrl = exec("git config --get remote.origin.url", { silent: true });
  if (!remoteUrl) throw new Error("找不到 remote.origin.url，無法判斷 GitLab project");

  if (remoteUrl.startsWith("git@")) {
    const match = remoteUrl.match(/git@([^:]+):(.+)/);
    if (!match) throw new Error("無法解析 remote URL（git@...）");
    const [, host, path] = match;
    const fullPath = path.replace(/\.git$/, "");
    return {
      host: `https://${host}`,
      hostname: host,
      projectPathEncoded: encodeURIComponent(fullPath),
      fullPath,
    };
  }

  if (remoteUrl.startsWith("https://")) {
    const url = new URL(remoteUrl);
    const fullPath = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean).join("/");
    return {
      host: `${url.protocol}//${url.host}`,
      hostname: url.host,
      projectPathEncoded: encodeURIComponent(fullPath),
      fullPath,
    };
  }

  throw new Error("無法解析 remote URL（僅支援 git@... 或 https://...）");
}

async function fetchJson(url, { token } = {}) {
  const headers = token ? { "PRIVATE-TOKEN": token } : {};
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`GitLab API 失敗: ${resp.status} ${resp.statusText} ${txt}`.trim());
  }
  return await resp.json();
}

async function listProjectLabels({ token, host, projectPathEncoded, useGlab }) {
  if (useGlab) {
    const data = glabApi(`projects/${projectPathEncoded}/labels`);
    if (Array.isArray(data)) return data;
  }
  if (!token) throw new Error("缺少 GITLAB_TOKEN，且 glab 未登入，無法讀取 labels");
  const url = `${host}/api/v4/projects/${projectPathEncoded}/labels?per_page=100`;
  return await fetchJson(url, { token });
}

function isoDateMinus3Months() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}

async function listMergeRequestsCreatedAfter({
  token,
  host,
  projectPathEncoded,
  createdAfterIso,
  maxMrs,
  useGlab,
}) {
  const perPage = 50;
  const all = [];
  let page = 1;

  while (all.length < maxMrs) {
    const remaining = Math.max(0, maxMrs - all.length);
    const pageSize = Math.min(perPage, remaining);

    if (useGlab) {
      const data = glabApi(
        `projects/${projectPathEncoded}/merge_requests?scope=all&state=all&order_by=created_at&sort=desc&created_after=${encodeURIComponent(
          createdAfterIso
        )}&per_page=${pageSize}&page=${page}`
      );
      if (!Array.isArray(data) || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      page += 1;
      continue;
    }

    if (!token) throw new Error("缺少 GITLAB_TOKEN，且 glab 未登入，無法讀取 MR 列表");

    const url = `${host}/api/v4/projects/${projectPathEncoded}/merge_requests?scope=all&state=all&order_by=created_at&sort=desc&created_after=${encodeURIComponent(
      createdAfterIso
    )}&per_page=${pageSize}&page=${page}`;
    const data = await fetchJson(url, { token });
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    page += 1;
  }

  return all.slice(0, maxMrs);
}

async function getMrChangesSummary({
  token,
  host,
  projectPathEncoded,
  mrIid,
  useGlab,
}) {
  const endpoint = `projects/${projectPathEncoded}/merge_requests/${mrIid}/changes`;

  let data = null;
  if (useGlab) {
    data = glabApi(endpoint);
  } else if (token) {
    data = await fetchJson(`${host}/api/v4/${endpoint}`, { token });
  }

  const files = Array.isArray(data?.changes)
    ? data.changes.map((c) => c?.new_path || c?.old_path).filter(Boolean)
    : [];

  const stats = [];
  if (typeof data?.changes_count === "string" || typeof data?.changes_count === "number") {
    stats.push(`filesChanged=${data.changes_count}`);
  } else if (files.length) {
    stats.push(`filesChanged=${files.length}`);
  }

  return {
    files: files.slice(0, 50),
    stats: stats.join(" "),
  };
}

async function listMrDiscussions({
  token,
  host,
  projectPathEncoded,
  mrIid,
  useGlab,
}) {
  const endpoint = `projects/${projectPathEncoded}/merge_requests/${mrIid}/discussions?per_page=100`;
  if (useGlab) {
    const data = glabApi(endpoint);
    return Array.isArray(data) ? data : [];
  }
  if (!token) return [];
  const url = `${host}/api/v4/${endpoint}`;
  const data = await fetchJson(url, { token });
  return Array.isArray(data) ? data : [];
}

function extractCommentsFromDiscussions(discussions, maxComments = 60) {
  const comments = [];
  for (const d of discussions || []) {
    const notes = Array.isArray(d?.notes) ? d.notes : [];
    for (const n of notes) {
      const message = typeof n?.body === "string" ? n.body.trim() : "";
      if (!message) continue;
      const pos = n?.position;
      const line =
        typeof pos?.new_line === "number"
          ? pos.new_line
          : typeof pos?.old_line === "number"
            ? pos.old_line
            : null;
      comments.push({ message, line });
      if (comments.length >= maxComments) return comments;
    }
  }
  return comments;
}

function pickPrimaryLabelId(mrLabels, labelNameToId) {
  if (!Array.isArray(mrLabels) || mrLabels.length === 0) return 0;
  const sorted = [...mrLabels].map(String).sort((a, b) => a.localeCompare(b));
  for (const name of sorted) {
    const id = labelNameToId.get(name);
    if (typeof id === "number") return id;
  }
  return 0;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function stableStringify(value) {
  // deterministic-ish stringify: sort keys recursively for objects
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const inner = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",");
  return `{${inner}}`;
}

function getAdaptSystemPrompt() {
  return [
    "You are a senior engineer helping to build a reusable repository knowledge base.",
    "Given GitLab labels, recent merge request samples, and git-flow data (branches, merge patterns), infer reusable knowledge.",
    "Return ONLY valid JSON (no markdown, no comments) matching this exact schema:",
    '{ "labels": [...], "coding-standard": [...], "git-flow": { "flowType": string, "defaultBranch": string, "summary": string, "branches": [{ "name": string, "role": string, "description": string }], "mergeFlow": string, "branchNaming": { "format": string, "examples": [string] }, "mrTargets": [string] } }',
    "",
    "Critical requirements for labels:",
    "- You MUST output one item for EVERY label in input.labels (use the same label name).",
    "- You MUST decide `applicable` to mark whether this label is suitable for this repo.",
    "  - Many labels can be irrelevant to a tooling repo; set applicable=false when the label seems unrelated to this repo's purpose/structure.",
    "  - If the label is a cross-cutting process/tooling label (e.g., FE Board / AI / Hotfix / Static File), it is usually applicable=true.",
    "- `applicable.reason` must explain why it is (or is not) suitable for this repo in 1-2 sentences.",
    "- scenario must NOT just copy label description; it must infer the typical usage based on the majority of MRs that applied this label.",
    "- If a minority of MRs uses the label in a way that contradicts the majority, treat them as error/outliers and IGNORE them.",
    "- For labels not seen in recent MRs, infer scenario from label name + description + repoStructure (project layout).",
    "- Prefer generic, reusable guidance (the 'most common' scenario), not edge cases.",
    "- Write scenario/rule/example in Traditional Chinese.",
    "",
    "Critical requirements for git-flow:",
    "- You MUST analyze input.gitFlowData (remoteHead, branches, mergePatterns, branchNamePatterns, recentMergeLog).",
    "- flowType: infer the overall flow (e.g. Git Flow 變體、GitHub Flow、Trunk-based).",
    "- defaultBranch: from gitFlowData.remoteHead or the branch that origin/HEAD points to.",
    "- summary: 1-3 sentences describing the flow in Traditional Chinese.",
    "- branches: list main long-lived branches with role and description (main, dev, release pattern, feat/fix pattern).",
    "- mergeFlow: describe merge direction (e.g. feat/fix -> release -> dev; release -> main).",
    "- branchNaming: infer format (e.g. type/TICKET) and examples from branchNamePatterns.",
    "- mrTargets: typical MR target branches (e.g. dev, release/X.Y.Z, main).",
    "- Write all git-flow fields in Traditional Chinese.",
  ].join("\n");
}

function getAdaptResponseJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["labels", "coding-standard", "git-flow"],
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "applicable", "scenario"],
          properties: {
            name: { type: "string", minLength: 1 },
            applicable: {
              type: "object",
              additionalProperties: false,
              required: ["ok", "reason"],
              properties: {
                ok: { type: "boolean" },
                reason: { type: "string", minLength: 1 },
              },
            },
            scenario: { type: "string", minLength: 1 },
          },
        },
      },
      "coding-standard": {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rule", "example"],
          properties: {
            rule: { type: "string", minLength: 1 },
            example: { type: "string", minLength: 1 },
          },
        },
      },
      "git-flow": {
        type: "object",
        additionalProperties: false,
        required: [
          "flowType",
          "defaultBranch",
          "summary",
          "branches",
          "mergeFlow",
          "branchNaming",
          "mrTargets",
        ],
        properties: {
          flowType: { type: "string", minLength: 1 },
          defaultBranch: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
          branches: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "role", "description"],
              properties: {
                name: { type: "string", minLength: 1 },
                role: { type: "string", minLength: 1 },
                description: { type: "string", minLength: 1 },
              },
            },
          },
          mergeFlow: { type: "string", minLength: 1 },
          branchNaming: {
            type: "object",
            additionalProperties: false,
            required: ["format", "examples"],
            properties: {
              format: { type: "string", minLength: 1 },
              examples: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
            },
          },
          mrTargets: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  };
}

function getAdaptLabelRepairSystemPrompt() {
  return [
    "You are repairing invalid cases in a repository knowledge JSON generation flow.",
    "Return ONLY valid JSON (no markdown, no comments).",
    "Task: Fix ONLY input.invalidCases and return normalized label objects.",
    "",
    "Output schema:",
    '{ "labels": [{ "name": string, "applicable": { "ok": boolean, "reason": string }, "scenario": string }] }',
    "",
    "Requirements:",
    "- Keep `name` exactly the same as each invalid case.",
    "- `applicable.reason` must clearly explain suitability for this repo in Traditional Chinese.",
    "- `scenario` must be a reusable common scenario in Traditional Chinese.",
    "- If confidence is low, still provide a conservative but valid result.",
  ].join("\n");
}

function getAdaptLabelRepairJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["labels"],
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "applicable", "scenario"],
          properties: {
            name: { type: "string", minLength: 1 },
            applicable: {
              type: "object",
              additionalProperties: false,
              required: ["ok", "reason"],
              properties: {
                ok: { type: "boolean" },
                reason: { type: "string", minLength: 1 },
              },
            },
            scenario: { type: "string", minLength: 1 },
          },
        },
      },
    },
  };
}

function getAdaptCodingStandardRepairSystemPrompt() {
  return [
    "You are repairing the `coding-standard` section for repository knowledge JSON.",
    "Return ONLY valid JSON (no markdown, no comments).",
    "",
    "Output schema:",
    '{ "coding-standard": [{ "rule": string, "example": string }] }',
    "",
    "Requirements:",
    "- Provide 3-8 practical, reusable coding standards.",
    "- Write in Traditional Chinese.",
    "- Keep examples short and concrete.",
  ].join("\n");
}

function getAdaptCodingStandardRepairJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["coding-standard"],
    properties: {
      "coding-standard": {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rule", "example"],
          properties: {
            rule: { type: "string", minLength: 1 },
            example: { type: "string", minLength: 1 },
          },
        },
      },
    },
  };
}

function getAdaptGitFlowRepairSystemPrompt() {
  return [
    "You are repairing the `git-flow` section for repository knowledge JSON.",
    "Return ONLY valid JSON (no markdown, no comments).",
    "",
    "Output schema:",
    '{ "git-flow": { "flowType": string, "defaultBranch": string, "summary": string, "branches": [{ "name": string, "role": string, "description": string }], "mergeFlow": string, "branchNaming": { "format": string, "examples": [string] }, "mrTargets": [string] } }',
    "",
    "Requirements:",
    "- Infer from input.gitFlowData.",
    "- All fields in Traditional Chinese except branch names/patterns.",
    "- Prefer conservative inference when uncertain, but keep schema valid.",
  ].join("\n");
}

function getAdaptGitFlowRepairJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["git-flow"],
    properties: {
      "git-flow": getAdaptResponseJsonSchema().properties["git-flow"],
    },
  };
}

/**
 * Collect git-flow related data from local repo (no GitLab API needed).
 * Used as input for LLM to infer and output git-flow section.
 */
function collectGitFlowData() {
  const result = {
    remoteHead: null,
    branches: { local: [], remote: [] },
    mergePatterns: [],
    branchNamePatterns: { feat: [], fix: [], release: [], other: [] },
    recentMergeLog: [],
  };

  try {
    // origin/HEAD -> default branch
    const headRef = exec("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true", {
      silent: true,
      throwOnError: false,
    });
    if (headRef && headRef.trim()) {
      const m = headRef.trim().match(/refs\/remotes\/origin\/(.+)/);
      result.remoteHead = m ? m[1] : headRef.replace("refs/remotes/origin/", "");
    }

    // All branches
    const branchOut = exec("git branch -a 2>/dev/null || true", {
      silent: true,
      throwOnError: false,
    });
    if (branchOut) {
      const lines = branchOut.split("\n").map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        const name = line.replace(/^\*\s*/, "").replace(/^remotes\/origin\//, "").trim();
        if (!name || name === "HEAD") continue;
        if (line.startsWith("remotes/")) {
          if (!result.branches.remote.includes(name)) result.branches.remote.push(name);
        } else {
          if (!result.branches.local.includes(name)) result.branches.local.push(name);
        }
      }
    }

    // Recent merge commits (last 30)
    const mergeLog = exec(
      'git log --oneline --grep="Merge branch" -30 2>/dev/null || true',
      { silent: true, throwOnError: false }
    );
    if (mergeLog) {
      result.recentMergeLog = mergeLog
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 25);
    }

    // Infer branch name patterns from remote branch names
    const remoteNames = result.branches.remote;
    for (const name of remoteNames) {
      if (/^feat[/-]/i.test(name) || /^feature\//i.test(name)) {
        result.branchNamePatterns.feat.push(name);
      } else if (/^fix\//i.test(name)) {
        result.branchNamePatterns.fix.push(name);
      } else if (/^release\//i.test(name)) {
        result.branchNamePatterns.release.push(name);
      } else if (!["main", "master", "dev"].includes(name) && !/^origin\//.test(name)) {
        result.branchNamePatterns.other.push(name);
      }
    }
    result.branchNamePatterns.feat = result.branchNamePatterns.feat.slice(0, 15);
    result.branchNamePatterns.fix = result.branchNamePatterns.fix.slice(0, 15);
    result.branchNamePatterns.release = result.branchNamePatterns.release.slice(0, 20);
    result.branchNamePatterns.other = result.branchNamePatterns.other.slice(0, 10);

    // Extract merge patterns from merge log
    const mergeInto = new Map();
    for (const line of result.recentMergeLog) {
      const m = line.match(/Merge branch '([^']+)' into '([^']+)'/);
      if (m) {
        const [, fromBranch, intoBranch] = m;
        const key = `${fromBranch} -> ${intoBranch}`;
        mergeInto.set(key, (mergeInto.get(key) || 0) + 1);
      } else {
        const m2 = line.match(/Merge branch '([^']+)'/);
        if (m2) {
          const key = `${m2[1]} -> (main/master?)`;
          mergeInto.set(key, (mergeInto.get(key) || 0) + 1);
        }
      }
    }
    result.mergePatterns = Array.from(mergeInto.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, v]) => `${k} (${v}次)`);

    return result;
  } catch {
    return result;
  }
}

function getRepoStructureSummary() {
  // Provide minimal repo structure hints for inferring scenarios of unused labels.
  // Keep it small to reduce token usage.
  try {
    const top = readdirSync(projectRoot, { withFileTypes: true })
      .filter((d) => d && d.name && !d.name.startsWith(".git"))
      .filter((d) => !["node_modules", "dist", "build", ".tmp"].includes(d.name))
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
      }));

    const cursor = existsSync(join(projectRoot, ".cursor"))
      ? readdirSync(join(projectRoot, ".cursor"), { withFileTypes: true })
          .filter((d) => d && d.name)
          .slice(0, 30)
          .map((d) => ({
            name: `.cursor/${d.name}`,
            type: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
          }))
      : [];

    return {
      topLevel: top.slice(0, 50),
      cursor: cursor,
    };
  } catch {
    return { topLevel: [], cursor: [] };
  }
}

function buildFallbackScenario({ name, description, usageCount, repoStructure }) {
  const desc = typeof description === "string" ? description.trim() : "";
  const used = typeof usageCount === "number" && usageCount > 0;

  if (used) {
    // Minimal fallback: we should almost never hit this for used labels if LLM did its job,
    // but keep wording safe and generic.
    return `此 label 曾於近三個月內被使用（${usageCount} 次）；建議以多數 MR 變更內容為準，套用於與其名稱「${name}」一致的通用情境。`;
  }

  const structureHint = Array.isArray(repoStructure?.topLevel)
    ? repoStructure.topLevel
        .filter((x) => x?.type === "dir")
        .map((x) => x.name)
        .slice(0, 10)
        .join(", ")
    : "";

  if (desc) {
    return `近三個月內未觀察到使用案例；可依 label 描述「${desc}」與 repo 結構（${structureHint || "無"}）推測適用情境，並以通用規則為主。`;
  }
  return `近三個月內未觀察到使用案例；可依 label 名稱「${name}」與 repo 結構（${structureHint || "無"}）推測適用情境，並以通用規則為主。`;
}

function buildFallbackApplicable({ name, usageCount }) {
  const used = typeof usageCount === "number" && usageCount > 0;
  if (used) {
    return {
      ok: true,
      reason: `近三個月內此 label 曾被使用（${usageCount} 次），推定與本 repo 的工作流程或工具變更相關。`,
    };
  }

  // Heuristic defaults for pantheon-like tooling repos:
  const allow = new Set([
    "FE Board",
    "AI",
    "Hotfix",
    "Static File",
    "Vendor Customization",
    "Plan",
  ]);
  if (allow.has(String(name))) {
    return {
      ok: true,
      reason: "此 label 屬於跨功能的流程/工具類標記，通常適用於 tooling 類 repo。",
    };
  }

  return {
    ok: false,
    reason: "此 label 多為產品/業務領域標記，對 tooling 類 repo 通常不適用。",
  };
}

async function attemptLlmJsonCall({ callArgs, sectionName, warnings, maxAttempts = 3 }) {
  const totalAttempts = Number.isFinite(maxAttempts)
    ? Math.max(1, Math.floor(maxAttempts))
    : 3;
  const attemptErrors = [];

  for (let i = 1; i <= totalAttempts; i++) {
    try {
      if (i > 1) {
        console.log(`🔁 LLM 重試 ${sectionName}（第 ${i}/${totalAttempts} 次）`);
      }
      return await callOpenAiJson(callArgs);
    } catch (e) {
      const msg = e?.message ? String(e.message) : String(e);
      attemptErrors.push(`attempt ${i}: ${msg}`);
    }
  }

  warnings.push(`${sectionName}: ${attemptErrors.join(" | ")}`);
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const filePath = args.file
    ? (String(args.file).startsWith("/")
        ? String(args.file)
        : join(projectRoot, String(args.file)))
    : getDefaultKnowledgeFile();

  const maxMrs = Number(args["max-mrs"] || 50);
  const createdAfterIso = String(args["created-after"] || isoDateMinus3Months());
  const llmRetryAttemptsRaw = Number(args["llm-retries"] ?? args["llm-repair-retries"] ?? 3);
  const llmRetryAttempts = Number.isFinite(llmRetryAttemptsRaw)
    ? Math.max(1, Math.floor(llmRetryAttemptsRaw))
    : 3;

  const projectInfo = getProjectInfo();
  const hostname = String(args["gitlab-host"] || projectInfo.host);

  const env = loadEnvLocal();
  const token = getGitLabToken();
  const useGlab = hasGlab() && isGlabAuthenticated(projectInfo.hostname);

  console.log(`\n🧩 adapt: repo=${projectInfo.fullPath}`);
  console.log(`📄 output: ${filePath}`);
  console.log(`🗓️  MR 篩選（created_at >= ${createdAfterIso}）`);
  console.log(`🔢 max MRs: ${maxMrs}`);
  console.log(`🔁 LLM 重試次數: ${llmRetryAttempts}`);
  console.log(`🔌 GitLab data source: ${useGlab ? "glab" : "token"}`);

  const gitFlowData = collectGitFlowData();

  const labels = await listProjectLabels({
    token,
    host: hostname,
    projectPathEncoded: projectInfo.projectPathEncoded,
    useGlab,
  });
  const labelNameToId = new Map(
    labels
      .filter((l) => l && typeof l === "object" && typeof l.name === "string")
      .map((l) => [l.name, Number(l.id)])
      .filter((pair) => Number.isFinite(pair[1]))
  );

  const mrs = await listMergeRequestsCreatedAfter({
    token,
    host: hostname,
    projectPathEncoded: projectInfo.projectPathEncoded,
    createdAfterIso,
    maxMrs,
    useGlab,
  });

  console.log(`🏷️  labels: ${labels.length}`);
  console.log(`🔀 merge requests: ${mrs.length}`);
  console.log(
    `🌿 git-flow: remoteHead=${gitFlowData.remoteHead ?? "?"} branches=${gitFlowData.branches?.remote?.length ?? 0} mergePatterns=${gitFlowData.mergePatterns?.length ?? 0}\n`
  );

  const mrSamples = [];
  for (const mr of mrs) {
    const mrIid = mr?.iid;
    if (!mrIid) continue;

    const changes = await getMrChangesSummary({
      token,
      host: hostname,
      projectPathEncoded: projectInfo.projectPathEncoded,
      mrIid,
      useGlab,
    }).catch(() => ({ files: [], stats: "" }));

    const discussions = await listMrDiscussions({
      token,
      host: hostname,
      projectPathEncoded: projectInfo.projectPathEncoded,
      mrIid,
      useGlab,
    }).catch(() => []);

    const comments = extractCommentsFromDiscussions(discussions, 60);
    const mrLabels = Array.isArray(mr?.labels) ? mr.labels : [];
    const primaryLabelId = pickPrimaryLabelId(mrLabels, labelNameToId);

    const changesTextParts = [
      `!${mrIid} ${mr?.title || ""}`.trim(),
      `labels: ${mrLabels.join(", ") || "(none)"}`,
      `created_at: ${mr?.created_at || ""}`,
      `state: ${mr?.state || ""}`,
    ];
    if (changes.stats) changesTextParts.push(changes.stats);
    if (changes.files.length) {
      changesTextParts.push(`files: ${changes.files.join(", ")}`);
    }
    const changesText = changesTextParts.filter(Boolean).join("\n");

    mrSamples.push({ label: primaryLabelId, changes: changesText, comments });
  }

  const labelUsageCount = new Map();
  for (const mr of mrs) {
    const mrLabels = Array.isArray(mr?.labels) ? mr.labels : [];
    for (const ln of mrLabels) {
      const key = String(ln);
      labelUsageCount.set(key, (labelUsageCount.get(key) || 0) + 1);
    }
  }

  // build input for caching + llm
  const repoStructure = getRepoStructureSummary();
  const inputPayload = {
    repo: { host: hostname, fullPath: projectInfo.fullPath },
    labels: labels.map((l) => ({ id: l.id, name: l.name, description: l.description || "" })),
    mrs: mrSamples,
    labelUsage: Object.fromEntries(
      labels
        .filter((l) => l && typeof l === "object" && typeof l.name === "string")
        .map((l) => [l.name, labelUsageCount.get(String(l.name)) || 0])
    ),
    repoStructure,
    gitFlowData,
    definition: {
      label: "primary label id (0 if none or unknown)",
      commentsLineFallback: "null when line info is not available",
      mrTimeFilter: `created_at >= ${createdAfterIso}`,
    },
  };

  const inputHash = sha256(stableStringify(inputPayload));

  const existing = readKnowledgeIfExists(filePath);
  const nowIso = new Date().toISOString();

  const base = existing || {
    labels: [],
    "coding-standard": [],
    meta: { schemaVersion: 1, generatedAt: nowIso },
    sources: {},
    cache: {},
  };

  base.meta = isPlainObject(base.meta) ? base.meta : {};
  base.meta.schemaVersion = 1;
  base.meta.updatedAt = nowIso;
  base.meta.repo = { host: hostname, fullPath: projectInfo.fullPath };

  base.sources = isPlainObject(base.sources) ? base.sources : {};
  base.sources.gitlab = {
    labelsCount: labels.length,
    mrCount: mrs.length,
    mrCreatedAfter: createdAfterIso,
    mrFilterField: "created_at",
  };
  base.sources.gitFlow = {
    remoteHead: gitFlowData.remoteHead,
    remoteBranchCount: gitFlowData.branches?.remote?.length ?? 0,
    mergePatternCount: gitFlowData.mergePatterns?.length ?? 0,
  };

  base.cache = isPlainObject(base.cache) ? base.cache : {};

  const noLlm = !!args["no-llm"];
  const cachedHash = base.cache?.inputHash;
  const canReuse = typeof cachedHash === "string" && cachedHash === inputHash;

  if (noLlm) {
    console.log("⏭️  跳過 LLM（--no-llm）");
    base.cache.inputHash = inputHash;
    base.cache.note = "llm skipped";
    // Still infer git-flow from local data (no API needed)
    const inferredGitFlow = inferGitFlowFromData(gitFlowData);
    if (inferredGitFlow) base["git-flow"] = inferredGitFlow;
    writeKnowledge(filePath, base);
    console.log(`✅ 已更新：${filePath}\n`);
    return;
  }

  if (canReuse) {
    console.log("✅ inputs 未變更，使用快取結果（跳過 LLM）");
    base.meta.cachedAt = nowIso;
    writeKnowledge(filePath, base);
    console.log(`✅ 已更新：${filePath}\n`);
    return;
  }

  // select provider
  const explicitProvider = typeof args["llm-provider"] === "string" ? args["llm-provider"] : null;
  const explicitModel = typeof args["llm-model"] === "string" ? args["llm-model"] : null;

  const openaiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || null;
  const compassApiToken = process.env.COMPASS_API_TOKEN || env.COMPASS_API_TOKEN || null;
  const compassOperatorProxyUrl =
    process.env.COMPASS_OPERATOR_PROXY_URL || env.COMPASS_OPERATOR_PROXY_URL || null;
  const customOpenAiApiUrl =
    process.env.CUSTOM_OPENAI_API_URL ||
    env.CUSTOM_OPENAI_API_URL ||
    "http://service-hub-ai.balinese-python.ts.net/v1";

  // Provider selection policy:
  // - Prefer OpenAI when OPENAI_API_KEY exists
  // - If no OPENAI_API_KEY, default to OpenAI-compatible API domain
  // - Keep compass as explicit opt-in only
  let provider = null;
  let degradedReason = null;

  if (explicitProvider) {
    const want = String(explicitProvider).toLowerCase();
    if (want === "openai") {
      if (openaiKey) {
        provider = "openai";
      } else {
        provider = "api-domain";
        degradedReason =
          "指定 openai provider 但缺少 OPENAI_API_KEY，將改走 CUSTOM_OPENAI_API_URL";
      }
    } else if (want === "api-domain" || want === "openai-domain" || want === "domain") {
      provider = "api-domain";
    } else if (want === "compass") {
      if (compassApiToken) {
        provider = "compass";
      } else {
        provider = openaiKey ? "openai" : "api-domain";
        degradedReason = "指定 compass provider 但缺少 COMPASS_API_TOKEN";
      }
    } else {
      provider = openaiKey ? "openai" : "api-domain";
      degradedReason = `未知 llm provider：${explicitProvider}，改用 ${provider}`;
    }
  } else {
    provider = openaiKey ? "openai" : "api-domain";
  }

  const model =
    resolveLlmModel({
      explicitModel,
      envLocal: env,
      envKeys: ["ADAPT_LLM_MODEL", "AI_MODEL", "LLM_MODEL", "OPENAI_MODEL"],
      defaultModel: "gpt-5.2",
    });

  if (degradedReason) {
    console.log(`⚠️  ${degradedReason}`);
  }
  console.log(`🤖 LLM: provider=${provider} model=${model}`);

  const llmWarnings = [];
  const llmFailureReason = "分析當下無法正確取得llm答覆，已改用保守推測。";

  const llmOutput = await attemptLlmJsonCall({
    callArgs: {
      apiKey: provider === "openai" ? openaiKey : null,
      customOpenAiApiUrl: provider === "api-domain" ? customOpenAiApiUrl : null,
      compassApiToken: provider === "compass" ? compassApiToken : null,
      compassOperatorProxyUrl: provider === "compass" ? compassOperatorProxyUrl : null,
      forceCompassProxy: provider === "compass",
      model,
      system: getAdaptSystemPrompt(),
      input: inputPayload,
      schema: getAdaptResponseJsonSchema(),
      schemaName: "adapt_repo_knowledge",
    },
    sectionName: "primary-output",
    warnings: llmWarnings,
    maxAttempts: llmRetryAttempts,
  });

  let rawOutLabels = llmOutput?.labels;
  let outCs = llmOutput?.["coding-standard"];
  let outGitFlow = llmOutput?.["git-flow"];

  if (!Array.isArray(rawOutLabels)) rawOutLabels = [];

  const primaryLabelMap = new Map();
  for (const item of rawOutLabels) {
    const n = typeof item?.name === "string" ? item.name.trim() : "";
    if (!n || primaryLabelMap.has(n)) continue;
    primaryLabelMap.set(n, item);
  }

  const invalidLabelCases = labels
    .filter((l) => l && typeof l === "object" && typeof l.name === "string")
    .map((l) => {
      const name = String(l.name);
      const candidate = primaryLabelMap.get(name);
      if (!candidate) {
        return {
          name,
          description: l.description || "",
          usageCount: labelUsageCount.get(name) || 0,
          error: "缺少該 label 的輸出",
          current: null,
        };
      }
      const norm = normalizeLabelItem(candidate);
      if (!norm.ok) {
        return {
          name,
          description: l.description || "",
          usageCount: labelUsageCount.get(name) || 0,
          error: norm.error,
          current: candidate,
        };
      }
      return null;
    })
    .filter(Boolean);

  const repairedLabelMap = new Map();
  if (invalidLabelCases.length > 0) {
    const repairResp = await attemptLlmJsonCall({
      callArgs: {
        apiKey: provider === "openai" ? openaiKey : null,
        customOpenAiApiUrl: provider === "api-domain" ? customOpenAiApiUrl : null,
        compassApiToken: provider === "compass" ? compassApiToken : null,
        compassOperatorProxyUrl: provider === "compass" ? compassOperatorProxyUrl : null,
        forceCompassProxy: provider === "compass",
        model,
        system: getAdaptLabelRepairSystemPrompt(),
        input: {
          repo: { host: hostname, fullPath: projectInfo.fullPath },
          invalidCases: invalidLabelCases,
          repoStructure,
          gitFlowData,
        },
        schema: getAdaptLabelRepairJsonSchema(),
        schemaName: "adapt_repo_knowledge_label_repair",
      },
      sectionName: "label-repair",
      warnings: llmWarnings,
      maxAttempts: llmRetryAttempts,
    });

    const repairedLabels = Array.isArray(repairResp?.labels) ? repairResp.labels : [];
    for (const item of repairedLabels) {
      const n = typeof item?.name === "string" ? item.name.trim() : "";
      if (!n || repairedLabelMap.has(n)) continue;
      const norm = normalizeLabelItem(item);
      if (norm.ok) repairedLabelMap.set(n, norm.value);
    }
  }

  const codingStandardCheck = validateCodingStandardSection(outCs);
  if (!codingStandardCheck.ok) {
    const repairResp = await attemptLlmJsonCall({
      callArgs: {
        apiKey: provider === "openai" ? openaiKey : null,
        customOpenAiApiUrl: provider === "api-domain" ? customOpenAiApiUrl : null,
        compassApiToken: provider === "compass" ? compassApiToken : null,
        compassOperatorProxyUrl: provider === "compass" ? compassOperatorProxyUrl : null,
        forceCompassProxy: provider === "compass",
        model,
        system: getAdaptCodingStandardRepairSystemPrompt(),
        input: {
          repo: { host: hostname, fullPath: projectInfo.fullPath },
          gitFlowData,
          mrs: mrSamples.slice(0, 20),
          labels: labels.map((l) => ({ name: l.name, description: l.description || "" })),
        },
        schema: getAdaptCodingStandardRepairJsonSchema(),
        schemaName: "adapt_repo_knowledge_cs_repair",
      },
      sectionName: "coding-standard-repair",
      warnings: llmWarnings,
      maxAttempts: llmRetryAttempts,
    });
    outCs = repairResp?.["coding-standard"];
  }

  const gitFlowCheck = validateGitFlowSection(outGitFlow);
  if (!gitFlowCheck.ok) {
    const repairResp = await attemptLlmJsonCall({
      callArgs: {
        apiKey: provider === "openai" ? openaiKey : null,
        customOpenAiApiUrl: provider === "api-domain" ? customOpenAiApiUrl : null,
        compassApiToken: provider === "compass" ? compassApiToken : null,
        compassOperatorProxyUrl: provider === "compass" ? compassOperatorProxyUrl : null,
        forceCompassProxy: provider === "compass",
        model,
        system: getAdaptGitFlowRepairSystemPrompt(),
        input: {
          repo: { host: hostname, fullPath: projectInfo.fullPath },
          gitFlowData,
          recentMrs: mrSamples.slice(0, 15).map((x) => x.changes),
        },
        schema: getAdaptGitFlowRepairJsonSchema(),
        schemaName: "adapt_repo_knowledge_gitflow_repair",
      },
      sectionName: "git-flow-repair",
      warnings: llmWarnings,
      maxAttempts: llmRetryAttempts,
    });
    outGitFlow = repairResp?.["git-flow"];
  }

  // Normalize labels output:
  // - Must cover ALL project labels
  // - If missing, fill with conservative fallback
  const outMap = new Map();
  for (const item of rawOutLabels) {
    const norm = normalizeLabelItem(item);
    if (!norm.ok) continue;
    const n = norm.value.name;
    if (outMap.has(n)) continue;
    outMap.set(n, norm.value);
  }

  const normalizedLabels = labels
    .filter((l) => l && typeof l === "object" && typeof l.name === "string")
    .map((l) => {
      const name = String(l.name);
      const found = outMap.get(name);
      const usageCount = labelUsageCount.get(name) || 0;
      const repaired = repairedLabelMap.get(name);
      const preferred = repaired || found;
      if (preferred && typeof preferred.scenario === "string" && preferred.scenario.trim()) {
        return {
          name,
          applicable:
            preferred.applicable && typeof preferred.applicable.ok === "boolean"
              ? preferred.applicable
              : buildFallbackApplicable({ name, usageCount }),
          scenario: preferred.scenario.trim(),
        };
      }
      return {
        name,
        applicable: {
          ...buildFallbackApplicable({ name, usageCount }),
          reason: llmFailureReason,
        },
        scenario: `（${llmFailureReason}）${buildFallbackScenario({
          name,
          description: l.description || "",
          usageCount,
          repoStructure,
        })}`,
      };
    });

  // Sort: applicable.ok=true first, then by name
  base.labels = normalizedLabels.sort((a, b) => {
    const aOk = a?.applicable?.ok === true ? 1 : 0;
    const bOk = b?.applicable?.ok === true ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  if (validateCodingStandardSection(outCs).ok) {
    base["coding-standard"] = outCs;
  } else {
    const existingCs = validateCodingStandardSection(base["coding-standard"]).ok
      ? base["coding-standard"]
      : [];
    base["coding-standard"] = existingCs.length
      ? existingCs
      : [
          {
            rule: "分析備註：本次 coding-standard 無法正確取得 llm 回覆",
            example: "請於下一次執行 adapt 時重試，或人工補齊 coding-standard 內容",
          },
        ];
  }

  if (outGitFlow != null && validateGitFlowSection(outGitFlow).ok) {
    base["git-flow"] = outGitFlow;
  } else {
    // Fallback: infer from local data when LLM didn't return valid git-flow
    const inferred = inferGitFlowFromData(gitFlowData);
    if (inferred) {
      inferred.summary = `${inferred.summary}（${llmFailureReason}）`;
      base["git-flow"] = inferred;
    }
  }

  base.cache.inputHash = inputHash;
  base.cache.llm = { provider, model, analyzedAt: nowIso };
  if (llmWarnings.length > 0) {
    base.cache.llm.warnings = llmWarnings.slice(0, 20);
    console.log(`⚠️  LLM 部分輸出異常，已採局部重試/保守降級（${llmWarnings.length} 項）`);
  }

  writeKnowledge(filePath, base);
  console.log(`✅ 已更新：${filePath}\n`);
}

main().catch((e) => {
  console.error(`\n❌ adapt 失敗：${e.message}\n`);
  process.exit(1);
});


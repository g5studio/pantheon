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
  return join(projectRoot, ".cursor", "tmp", "pantheon", "adapt.json");
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
    "Given GitLab labels and recent merge request samples, infer reusable knowledge.",
    "Return ONLY valid JSON (no markdown, no comments) matching this exact schema:",
    '{ "labels": [{ "name": string, "applicable": { "ok": boolean, "reason": string }, "scenario": string }], "coding-standard": [{ "rule": string, "example": string }] }',
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
  ].join("\n");
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const filePath = args.file
    ? (String(args.file).startsWith("/")
        ? String(args.file)
        : join(projectRoot, String(args.file)))
    : getDefaultKnowledgeFile();

  const maxMrs = Number(args["max-mrs"] || 50);
  const createdAfterIso = String(args["created-after"] || isoDateMinus3Months());

  const projectInfo = getProjectInfo();
  const hostname = String(args["gitlab-host"] || projectInfo.host);

  const env = loadEnvLocal();
  const token = getGitLabToken();
  const useGlab = hasGlab() && isGlabAuthenticated(projectInfo.hostname);

  console.log(`\n🧩 adapt: repo=${projectInfo.fullPath}`);
  console.log(`📄 output: ${filePath}`);
  console.log(`🗓️  MR 篩選（created_at >= ${createdAfterIso}）`);
  console.log(`🔢 max MRs: ${maxMrs}`);
  console.log(`🔌 GitLab data source: ${useGlab ? "glab" : "token"}`);

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
  console.log(`🔀 merge requests: ${mrs.length}\n`);

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

  base.cache = isPlainObject(base.cache) ? base.cache : {};

  const noLlm = !!args["no-llm"];
  const cachedHash = base.cache?.inputHash;
  const canReuse = typeof cachedHash === "string" && cachedHash === inputHash;

  if (noLlm) {
    console.log("⏭️  跳過 LLM（--no-llm）");
    base.cache.inputHash = inputHash;
    base.cache.note = "llm skipped";
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

  // Provider selection policy:
  // - Prefer OpenAI when OPENAI_API_KEY exists
  // - If no OPENAI_API_KEY, degrade to no-llm automatically (do NOT fail)
  let provider = null;
  let degradedReason = null;

  if (explicitProvider) {
    const want = String(explicitProvider).toLowerCase();
    if (want === "openai") {
      if (openaiKey) provider = "openai";
    } else if (want === "compass") {
      degradedReason = "不支援 compass provider（已移除）";
    } else {
      degradedReason = `未知 llm provider：${explicitProvider}`;
    }
  } else {
    provider = openaiKey ? "openai" : null;
  }

  if (!provider) {
    console.log(
      "\n⏭️  未配置 OPENAI_API_KEY，將自動以 --no-llm 模式執行（只更新 sources/meta/cache）\n"
    );
    base.cache.inputHash = inputHash;
    base.cache.note = "llm skipped: no api key";
    writeKnowledge(filePath, base);
    console.log(`✅ 已更新：${filePath}\n`);
    return;
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

  const llmOutput = await callOpenAiJson({
    apiKey: openaiKey,
    model,
    system: getAdaptSystemPrompt(),
    input: inputPayload,
  });

  const rawOutLabels = llmOutput?.labels;
  const outCs = llmOutput?.["coding-standard"];

  const a = validateLabelsSection(rawOutLabels);
  if (!a.ok) throw new Error(`LLM output schema 錯誤：${a.error}`);
  const b = validateCodingStandardSection(outCs);
  if (!b.ok) throw new Error(`LLM output schema 錯誤：${b.error}`);

  // Normalize labels output:
  // - Must cover ALL project labels
  // - If missing, fill with conservative fallback
  const outMap = new Map();
  for (const item of rawOutLabels) {
    const n = typeof item?.name === "string" ? item.name.trim() : "";
    const s = typeof item?.scenario === "string" ? item.scenario.trim() : "";
    const aRaw = item?.applicable;
    const applicable =
      typeof aRaw === "boolean"
        ? { ok: aRaw, reason: aRaw ? "（由 LLM 判定為適用）" : "（由 LLM 判定為不適用）" }
        : isPlainObject(aRaw) &&
            typeof aRaw.ok === "boolean" &&
            typeof aRaw.reason === "string"
          ? { ok: aRaw.ok, reason: aRaw.reason.trim() }
          : undefined;
    if (!n) continue;
    if (outMap.has(n)) continue;
    outMap.set(n, {
      name: n,
      applicable,
      scenario: s || "（缺少 scenario，請補充）",
    });
  }

  const normalizedLabels = labels
    .filter((l) => l && typeof l === "object" && typeof l.name === "string")
    .map((l) => {
      const name = String(l.name);
      const found = outMap.get(name);
      const usageCount = labelUsageCount.get(name) || 0;
      if (found && typeof found.scenario === "string" && found.scenario.trim()) {
        return {
          name,
          applicable:
            found.applicable && typeof found.applicable.ok === "boolean"
              ? found.applicable
              : buildFallbackApplicable({ name, usageCount }),
          scenario: found.scenario.trim(),
        };
      }
      return {
        name,
        applicable: buildFallbackApplicable({ name, usageCount }),
        scenario: buildFallbackScenario({
          name,
          description: l.description || "",
          usageCount,
          repoStructure,
        }),
      };
    });

  // Sort: applicable.ok=true first, then by name
  base.labels = normalizedLabels.sort((a, b) => {
    const aOk = a?.applicable?.ok === true ? 1 : 0;
    const bOk = b?.applicable?.ok === true ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  base["coding-standard"] = outCs;

  base.cache.inputHash = inputHash;
  base.cache.llm = { provider, model, analyzedAt: nowIso };

  writeKnowledge(filePath, base);
  console.log(`✅ 已更新：${filePath}\n`);
}

main().catch((e) => {
  console.error(`\n❌ adapt 失敗：${e.message}\n`);
  process.exit(1);
});


#!/usr/bin/env node

/**
 * query-file - Mounted-safe file query helper
 *
 * Goals:
 * - Prefer external tool (CodeGraph) when available.
 * - Keep behavior identical in Pantheon repo and mounted projects.
 * - Keep local index + content fallback as resilient backup path.
 */

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { extname, join, relative } from "path";
import { getProjectRoot } from "./env-loader.mjs";

const projectRoot = getProjectRoot();
const indexFilePath = join(projectRoot, ".evolve-tmp", "query-file-index.json");
const codegraphDirPath = join(projectRoot, ".codegraph");
const codegraphNpxPrefix = "npx -y @colbymchenry/codegraph";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

const EXCLUDE_DIRS = new Set([
  ".git",
  ".pantheon",
  ".evolve-tmp",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "out",
  "vendor",
  "__pycache__",
  ".turbo",
  ".cache",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".zip",
  ".tar",
  ".gz",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".lock",
]);

function parseArgs(argv) {
  const args = {
    keyword: "",
    path: "",
    limit: DEFAULT_LIMIT,
    provider: "auto",
    reindex: false,
    indexOnly: false,
    noContent: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--keyword=") || arg.startsWith("-k=")) {
      args.keyword = arg.split("=").slice(1).join("=");
    } else if (arg === "--keyword" || arg === "-k") {
      args.keyword = argv[++i] || "";
    } else if (arg.startsWith("--path=") || arg.startsWith("--paths=")) {
      args.path = arg.split("=").slice(1).join("=");
    } else if (arg === "--path" || arg === "--paths") {
      args.path = argv[++i] || "";
    } else if (arg.startsWith("--limit=") || arg.startsWith("-n=")) {
      args.limit = Number(arg.split("=").slice(1).join("="));
    } else if (arg === "--limit" || arg === "-n") {
      args.limit = Number(argv[++i]);
    } else if (arg.startsWith("--provider=")) {
      args.provider = arg.split("=").slice(1).join("=");
    } else if (arg === "--provider") {
      args.provider = argv[++i] || "auto";
    } else if (arg === "--reindex") {
      args.reindex = true;
    } else if (arg === "--index-only") {
      args.indexOnly = true;
    } else if (arg === "--no-content") {
      args.noContent = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (!arg.startsWith("-") && !args.keyword) {
      args.keyword = arg;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    args.limit = DEFAULT_LIMIT;
  }
  args.limit = Math.min(args.limit, MAX_LIMIT);
  args.provider = String(args.provider || "auto").toLowerCase();
  if (!["auto", "codegraph", "local"].includes(args.provider)) {
    args.provider = "auto";
  }

  return args;
}

function ensureDirForFile(filePath) {
  const dir = filePath.slice(0, filePath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function isTextLikeFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  return !BINARY_EXTENSIONS.has(ext);
}

function listFilesRecursively(startDir, results = []) {
  const entries = readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(startDir, entry.name);
    const relPath = relative(projectRoot, absolutePath);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      listFilesRecursively(absolutePath, results);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!isTextLikeFile(absolutePath)) continue;

    results.push(relPath);
  }

  return results;
}

function buildIndex() {
  const files = listFilesRecursively(projectRoot, []).sort((a, b) =>
    a.localeCompare(b),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    projectRoot,
    fileCount: files.length,
    files: files.map((path) => {
      const parts = path.split("/");
      const name = parts[parts.length - 1] || path;
      return {
        path,
        name,
        lowerPath: path.toLowerCase(),
        lowerName: name.toLowerCase(),
      };
    }),
  };

  ensureDirForFile(indexFilePath);
  writeFileSync(indexFilePath, JSON.stringify(payload, null, 2), "utf-8");

  return payload;
}

function readIndex() {
  if (!existsSync(indexFilePath)) return null;
  try {
    return JSON.parse(readFileSync(indexFilePath, "utf-8"));
  } catch {
    return null;
  }
}

function parsePathFilters(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function matchPathFilter(filePath, filters) {
  if (filters.length === 0) return true;
  const lower = filePath.toLowerCase();
  return filters.some(
    (f) => lower === f || lower.startsWith(`${f}/`) || lower.includes(`/${f}/`),
  );
}

function scoreFile(entry, keywordLower) {
  let score = 0;
  if (entry.lowerName === keywordLower) score += 120;
  if (entry.lowerName.startsWith(keywordLower)) score += 80;
  if (entry.lowerPath.includes(`/${keywordLower}`)) score += 60;
  if (entry.lowerPath.includes(keywordLower)) score += 30;
  return score;
}

function queryFromIndex(index, { keyword, pathFilters, limit }) {
  const keywordLower = keyword.toLowerCase();
  const scored = [];

  for (const entry of index.files || []) {
    if (!matchPathFilter(entry.path, pathFilters)) continue;
    const score = scoreFile(entry, keywordLower);
    if (score <= 0) continue;
    scored.push({ path: entry.path, score, source: "index" });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const dedup = [];
  const seen = new Set();
  for (const item of scored) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    dedup.push(item);
    if (dedup.length >= limit) break;
  }
  return dedup;
}

function runContentFallback({ keyword, pathFilters, limit }) {
  const roots = pathFilters.length > 0 ? pathFilters : ["."];
  const rows = [];

  for (const root of roots) {
    const abs = join(projectRoot, root);
    if (!existsSync(abs)) continue;
    const stat = statSync(abs);
    if (!stat.isDirectory() && !stat.isFile()) continue;

    try {
      const cmd = `rg --line-number --no-heading --smart-case --max-count ${Math.max(
        20,
        limit * 2,
      )} ${JSON.stringify(keyword)} ${JSON.stringify(root)}`;
      const out = execSync(cmd, {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();

      if (!out) continue;

      const lines = out.split("\n").filter(Boolean);
      for (const line of lines) {
        const first = line.indexOf(":");
        if (first <= 0) continue;
        const filePath = line.slice(0, first);
        if (!filePath || !matchPathFilter(filePath, pathFilters)) continue;
        rows.push({ path: filePath, score: 10, source: "content" });
      }
    } catch {
      // rg exits with code 1 when no matches; ignore.
    }
  }

  const dedup = [];
  const seen = new Set();
  for (const item of rows) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    dedup.push(item);
    if (dedup.length >= limit) break;
  }
  return dedup;
}

function runCommand(command) {
  return execSync(command, {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

function hasCodegraphCli() {
  try {
    runCommand("codegraph --version");
    return true;
  } catch {
    return false;
  }
}

function hasCodegraphIndex() {
  return existsSync(codegraphDirPath);
}

function hasCodegraphNpx() {
  try {
    runCommand(`${codegraphNpxPrefix} --version`);
    return true;
  } catch {
    return false;
  }
}

function resolveCodegraphRuntime() {
  if (hasCodegraphCli()) {
    return { available: true, mode: "cli", prefix: "codegraph" };
  }
  if (hasCodegraphNpx()) {
    return { available: true, mode: "npx", prefix: codegraphNpxPrefix };
  }
  return { available: false, mode: null, prefix: null };
}

function ensureCodegraphIndex(runtime) {
  if (!runtime?.available || !runtime.prefix) {
    return { ok: false, initialized: false };
  }
  if (hasCodegraphIndex()) {
    return { ok: true, initialized: false };
  }

  try {
    runCommand(`${runtime.prefix} init`);
  } catch {
    return { ok: false, initialized: false };
  }

  return { ok: hasCodegraphIndex(), initialized: hasCodegraphIndex() };
}

function looksLikeSourcePath(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s || s.startsWith("http://") || s.startsWith("https://")) return false;
  const normalized = s.replace(/\\/g, "/");
  if (!normalized.includes("/")) return false;
  const ext = extname(normalized).toLowerCase();
  if (!ext || ext.length > 10) return false;
  return !BINARY_EXTENSIONS.has(ext);
}

function normalizePossiblePath(rawPath) {
  if (typeof rawPath !== "string") return null;
  const normalized = rawPath.trim().replace(/\\/g, "/");
  if (!normalized) return null;

  if (normalized.startsWith(projectRoot)) {
    const rel = relative(projectRoot, normalized);
    return rel && !rel.startsWith("..") ? rel : null;
  }

  if (normalized.startsWith("./")) return normalized.slice(2);
  if (normalized.startsWith("/")) return null;
  return normalized;
}

function collectPathsFromUnknownJson(node, collector) {
  if (Array.isArray(node)) {
    for (const item of node) collectPathsFromUnknownJson(item, collector);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      collectPathsFromUnknownJson(value, collector);
    }
    return;
  }
  if (looksLikeSourcePath(node)) {
    const rel = normalizePossiblePath(node);
    if (rel) collector.add(rel);
  }
}

function parseCodegraphJsonOutput(raw) {
  try {
    const parsed = JSON.parse(raw);
    const pathSet = new Set();
    collectPathsFromUnknownJson(parsed, pathSet);
    const rows = [];
    for (const path of pathSet) {
      const abs = join(projectRoot, path);
      if (!existsSync(abs)) continue;
      if (!isTextLikeFile(abs)) continue;
      rows.push(path);
    }
    return rows;
  } catch {
    return [];
  }
}

function queryFromCodegraph({ keyword, pathFilters, limit, runtimePrefix }) {
  const results = [];
  const seen = new Set();

  const commands = [
    `${runtimePrefix} query ${JSON.stringify(keyword)} --json`,
    `${runtimePrefix} files --json`,
  ];

  for (const cmd of commands) {
    try {
      const raw = runCommand(cmd);
      if (!raw) continue;
      const paths = parseCodegraphJsonOutput(raw);
      for (const path of paths) {
        if (!matchPathFilter(path, pathFilters)) continue;
        const lower = path.toLowerCase();
        const score = lower.includes(keyword.toLowerCase()) ? 50 : 20;
        if (seen.has(path)) continue;
        seen.add(path);
        results.push({ path, score, source: "codegraph" });
        if (results.length >= limit) return results;
      }
    } catch {
      // Ignore command errors and continue fallback flow.
    }
  }

  return results;
}

function printHelp() {
  console.log(`query-file - Mounted-safe file query helper

Usage:
  node query-file.mjs --keyword=<text> [options]
  node query-file.mjs <keyword> [options]

Options:
  -k, --keyword=<text>     Search keyword (file name or partial path)
  --path=<a,b,c>           Limit search scope by path prefixes
  -n, --limit=<number>     Max results (default: 20, max: 200)
  --provider=<auto|codegraph|local>  Query provider (default: auto)
  --reindex                Force rebuild local index before query
  --index-only             Rebuild index and exit
  --no-content             Disable rg content fallback
  --json                   Output JSON format
  -h, --help               Show help

Examples:
  node query-file.mjs jira-content-formatter
  node query-file.mjs --keyword=update-jira --path=.cursor/scripts/jira
  node query-file.mjs --reindex --index-only
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let index = null;
  let indexBuilt = false;

  if (args.reindex) {
    index = buildIndex();
    indexBuilt = true;
  } else {
    index = readIndex();
  }

  if (!index) {
    index = buildIndex();
    indexBuilt = true;
  }

  if (args.indexOnly) {
    const payload = {
      success: true,
      action: "index-only",
      indexFile: relative(projectRoot, indexFilePath),
      generatedAt: index.generatedAt,
      fileCount: index.fileCount,
      indexBuilt,
    };
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`✅ index updated: ${payload.indexFile}`);
      console.log(`📁 files indexed: ${payload.fileCount}`);
      console.log(`🕒 generatedAt: ${payload.generatedAt}`);
    }
    return;
  }

  if (!args.keyword) {
    printHelp();
    process.exit(1);
  }

  const pathFilters = parsePathFilters(args.path);
  const codegraphRuntime = resolveCodegraphRuntime();
  const codegraphInitResult = ensureCodegraphIndex(codegraphRuntime);
  const canUseCodegraph = codegraphRuntime.available && codegraphInitResult.ok;
  const useCodegraph =
    args.provider === "codegraph"
      ? canUseCodegraph
      : args.provider === "local"
        ? false
        : canUseCodegraph;

  let providerUsed = useCodegraph ? "codegraph" : "local";
  let providerFallbackReason = null;

  let results = [];
  if (useCodegraph) {
    results = queryFromCodegraph({
      keyword: args.keyword,
      pathFilters,
      limit: args.limit,
      runtimePrefix: codegraphRuntime.prefix,
    });
    if (results.length === 0 && args.provider === "codegraph") {
      providerFallbackReason =
        "CodeGraph query returned no result; local fallback is applied.";
      providerUsed = "local";
    }
  } else if (args.provider === "codegraph") {
    providerFallbackReason =
      "CodeGraph is unavailable (runtime missing or init failed); local fallback is applied.";
    providerUsed = "local";
  }

  if (providerUsed === "local") {
    const fromIndex = queryFromIndex(index, {
      keyword: args.keyword,
      pathFilters,
      limit: args.limit,
    });

    results = [...fromIndex];
    if (results.length < args.limit && !args.noContent) {
      const fallbackRows = runContentFallback({
        keyword: args.keyword,
        pathFilters,
        limit: args.limit,
      });
      const seen = new Set(results.map((r) => r.path));
      for (const row of fallbackRows) {
        if (seen.has(row.path)) continue;
        seen.add(row.path);
        results.push(row);
        if (results.length >= args.limit) break;
      }
    }
  }

  const payload = {
    success: true,
    keyword: args.keyword,
    providerRequested: args.provider,
    providerUsed,
    codegraph: {
      available: canUseCodegraph,
      runtimeMode: codegraphRuntime.mode,
      initialized: hasCodegraphIndex(),
      autoInitialized: codegraphInitResult.initialized,
    },
    providerFallbackReason,
    pathFilters,
    limit: args.limit,
    indexFile: relative(projectRoot, indexFilePath),
    indexBuilt,
    resultCount: results.length,
    results,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`🔎 keyword: ${args.keyword}`);
  console.log(`🧰 provider: ${providerUsed} (requested: ${args.provider})`);
  if (providerFallbackReason) {
    console.log(`⚠️ ${providerFallbackReason}`);
  }
  if (pathFilters.length > 0) {
    console.log(`📂 paths: ${pathFilters.join(", ")}`);
  }
  console.log(`📊 resultCount: ${results.length}`);
  console.log(
    `🧠 index: ${relative(projectRoot, indexFilePath)}${indexBuilt ? " (rebuilt)" : ""}`,
  );
  console.log("");

  if (results.length === 0) {
    console.log("No matched files.");
    return;
  }

  for (const item of results) {
    console.log(`- ${item.path} (${item.source})`);
  }
}

main();

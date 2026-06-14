#!/usr/bin/env node

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { getProjectRoot, loadEnvLocal } from "./env-loader.mjs";
import { callOpenAiJson, resolveLlmModel } from "./llm-client.mjs";

const projectRoot = getProjectRoot();
const EVOLVE_TMP_DIR = join(projectRoot, ".evolve-tmp");
const ADAPT_FILE = join(projectRoot, "adapt.json");
const REPORT_FILE = join(projectRoot, "misnamed-file-report.md");
const PROGRESS_FILE = join(EVOLVE_TMP_DIR, "analysis-progress.json");

const TICKET_PATTERN = /\b([A-Z]+-\d+)\b/g;
const NOISE_COMMIT_SUBJECT_PATTERNS = [
  /fix\([^)]*\):\s*fix all files eslint error/i,
  /^update$/i,
  /^chore:\s*bump version$/i,
  /\bformat-and-lint\b/i,
];
const ANNOTATION_AUDIT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
]);

const DEFAULT_EXCLUDE_DIRS = new Set([
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

const DEFAULT_EXCLUDE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

const ANALYZABLE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".scala",
  ".sh",
  ".bash",
  ".zsh",
  ".yaml",
  ".yml",
  ".json",
  ".md",
  ".mdc",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".xml",
  ".sql",
  ".graphql",
  ".gql",
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
]);

const SCHEMA_SKILL = {
  name: "project-schema",
  managedMarker: "managed-by-pantheon-evolve",
  relativePath: join(".cursor", "skills", "project-schema", "SKILL.md"),
};

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

function safeJsonParse(text, hint = "JSON") {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${hint} 解析失敗：${e.message}`);
  }
}

function readJsonInput(input, inputFile) {
  if (inputFile) {
    const path = join(projectRoot, inputFile);
    if (!existsSync(path)) {
      throw new Error(`找不到輸入檔案：${path}`);
    }
    return safeJsonParse(readFileSync(path, "utf-8"), inputFile);
  }
  if (input) {
    return safeJsonParse(input, "--input");
  }
  throw new Error("請提供 --input 或 --input-file");
}

function ensureDirForFile(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function ensureEvolveTmpDir() {
  if (!existsSync(EVOLVE_TMP_DIR)) {
    mkdirSync(EVOLVE_TMP_DIR, { recursive: true });
  }
}

function extractTickets(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(TICKET_PATTERN) || [];
  return [...new Set(matches)];
}

function isNoiseCommitSubject(subject) {
  if (!subject || typeof subject !== "string") return false;
  return NOISE_COMMIT_SUBJECT_PATTERNS.some((pattern) =>
    pattern.test(subject.trim()),
  );
}

function getFileHistorySubjects(filePath, max = 20) {
  const safeMax = Number(max) > 0 ? Number(max) : 20;
  const raw = exec(
    `git log --follow --max-count=${safeMax} --format="%s" -- "${filePath}"`,
    { silent: true, throwOnError: false },
  );
  if (!raw) return [];
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractDeclarationSignatures(content) {
  const lines = String(content || "").split("\n");
  const signatures = [];
  const declarationPattern =
    /^\s*(export\s+)?(default\s+)?(async\s+)?(function|const|let|var|class)\b.+$/;

  for (const line of lines) {
    if (!declarationPattern.test(line)) continue;
    const normalized = line.trim();
    if (!normalized) continue;
    signatures.push(normalized.slice(0, 180));
  }

  return [...new Set(signatures)].slice(0, 160);
}

function getDeclarationOriginTickets(filePath, signatures) {
  const result = [];
  for (const signature of signatures) {
    const escaped = signature.replace(/"/g, '\\"');
    const raw = exec(
      `git log --reverse --max-count=80 --format="%H|%s" -S "${escaped}" -- "${filePath}"`,
      { silent: true, throwOnError: false },
    );
    if (!raw) {
      result.push({ signature, originSubject: null, tickets: [] });
      continue;
    }

    const commits = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, subject] = line.split("|");
        return {
          hash,
          subject: subject || "",
          tickets: extractTickets(subject || ""),
        };
      });

    const origin =
      commits.find(
        (c) => !isNoiseCommitSubject(c.subject) && c.tickets.length > 0,
      ) ||
      commits.find((c) => !isNoiseCommitSubject(c.subject)) ||
      commits[0];

    result.push({
      signature,
      originSubject: origin?.subject || null,
      tickets: origin?.tickets || [],
    });
  }
  return result;
}

function stripLooseComments(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function isCommentOnlyChange(before, after) {
  const normalizedBefore = stripLooseComments(before)
    .replace(/\s+/g, " ")
    .trim();
  const normalizedAfter = stripLooseComments(after).replace(/\s+/g, " ").trim();
  return normalizedBefore === normalizedAfter;
}

function isAnalyzableFile(filePath) {
  const base = basename(filePath);
  if (DEFAULT_EXCLUDE_FILES.has(base)) return false;
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return ANALYZABLE_EXTENSIONS.has(ext);
}

function walkFiles(startDir, results = []) {
  if (!existsSync(startDir)) return results;

  const entries = readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(startDir, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDE_DIRS.has(entry.name)) continue;
      walkFiles(fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isAnalyzableFile(fullPath)) continue;
    results.push(relative(projectRoot, fullPath));
  }
  return results;
}

function getSchemaTargetPaths() {
  const targets = [
    join(projectRoot, ".cursor", "skills", SCHEMA_SKILL.name, "SKILL.md"),
    join(projectRoot, ".agents", "skills", SCHEMA_SKILL.name, "SKILL.md"),
  ];

  const singularAgentPath = join(projectRoot, ".agent");
  if (existsSync(singularAgentPath)) {
    targets.push(
      join(projectRoot, ".agent", "skills", SCHEMA_SKILL.name, "SKILL.md"),
    );
  }

  return targets;
}

function renderSchemaSkill(schema) {
  const modules = Array.isArray(schema.modules) ? schema.modules : [];
  const entryPoints = Array.isArray(schema.entryPoints)
    ? schema.entryPoints
    : [];
  const conventions = schema.conventions || {};

  const moduleTable = modules
    .map((m) => {
      const paths = Array.isArray(m.paths) ? m.paths.join(", ") : "";
      const deps = Array.isArray(m.dependencies)
        ? m.dependencies.join(", ")
        : "";
      return `| \`${m.id || ""}\` | ${m.name || ""} | \`${paths}\` | ${m.responsibility || ""} | ${deps || "-"} |`;
    })
    .join("\n");

  const moduleDetails = modules
    .map((m) => {
      const paths = Array.isArray(m.paths)
        ? m.paths.map((p) => `- \`${p}\``).join("\n")
        : "";
      const deps =
        Array.isArray(m.dependencies) && m.dependencies.length
          ? m.dependencies.map((d) => `- \`${d}\``).join("\n")
          : "- （無）";
      return `### ${m.name || m.id || "未命名模塊"} (\`${m.id || ""}\`)

**職責**：${m.responsibility || "（待補充）"}

**路徑範圍**：
${paths || "- （待補充）"}

**邊界（不應包含）**：${m.boundaries || "（待補充）"}

**依賴模塊**：
${deps}
`;
    })
    .join("\n");

  const entryList = entryPoints.length
    ? entryPoints.map((p) => `- \`${p}\``).join("\n")
    : "- （待補充）";

  return `---
name: project-schema
description: Project module architecture and boundaries for Operator Agent workflows. Use when navigating codebase structure, determining file ownership, or validating changes against module boundaries.
---
<!-- ${SCHEMA_SKILL.managedMarker} -->

# Project Schema: ${schema.projectName || "Unknown Project"}

${schema.summary || "（待補充專案摘要）"}

## When To Use

Read this skill when:

1. You need to understand which module a file belongs to
2. You are planning changes and need to respect module boundaries
3. You are reviewing whether a new file is placed in the correct directory
4. You are executing \`evolve\`, \`start-task\`, or other Operator workflows

## Entry Points

${entryList}

## Module Overview

| Module ID | Name | Paths | Responsibility | Dependencies |
|---|---|---|---|---|
${moduleTable || "| - | - | - | - | - |"}

## Module Details

${moduleDetails || "（尚無模塊定義）"}

## Conventions

| Item | Description |
|---|---|
| Naming | ${conventions.naming || "（參考 adapt.json coding-standard）"} |
| Comment Style | ${conventions.commentStyle || "（參考 adapt.json coding-standard）"} |

## Architecture

\`\`\`mermaid
flowchart TD
${modules
  .map((m, i) => {
    const id = m.id || `module${i}`;
    return `  ${id}["${m.name || id}"]`;
  })
  .join("\n")}
\`\`\`

---

> Generated by \`evolve\` command. Re-run \`evolve\` phase 1 to update after major structural changes.
`;
}

function renderMisnamedReport(analysis) {
  const files = Array.isArray(analysis.files) ? analysis.files : [];
  const misnamed = files.filter((f) => f.nameMatchesPurpose === false);
  const generatedAt = new Date().toISOString();

  const rows = misnamed
    .map((f) => {
      const tickets = Array.isArray(f.tickets) ? f.tickets.join(", ") : "";
      return `| \`${f.module || "-"}\` | \`${f.path || "-"}\` | ${f.actualPurpose || "-"} | \`${f.recommendedName || "-"}\` | ${tickets || "-"} |`;
    })
    .join("\n");

  return `# Misnamed File Report

> Generated at: ${generatedAt}
> Total files analyzed: ${files.length}
> Misnamed files: ${misnamed.length}

## Summary

${
  misnamed.length === 0
    ? "未發現命名與用途不符的檔案。"
    : `共發現 ${misnamed.length} 個檔案命名與實際用途不符，建議重新命名。`
}

## Details

| Module | Original Path | Actual Purpose | Recommended Name | Related Tickets |
|---|---|---|---|---|
${rows || "| - | - | - | - | - |"}

## Next Steps

1. Review the table above and confirm recommended names
2. Run \`evolve\` rename phase with user confirmation
3. Update imports and run lint/typecheck after renaming

---

> Generated by \`evolve\` command (\`write-report\`).
`;
}

function cmdCheckPrereq() {
  if (!existsSync(ADAPT_FILE)) {
    console.error("❌ adapt.json 不存在。請先執行 adapt 指令。");
    process.exit(1);
  }

  const adapt = safeJsonParse(readFileSync(ADAPT_FILE, "utf-8"), "adapt.json");
  const codingStandard = Array.isArray(adapt["coding-standard"])
    ? adapt["coding-standard"]
    : [];
  const gitFlow = adapt["git-flow"] || {};
  const labels = Array.isArray(adapt.labels) ? adapt.labels : [];

  console.log("✅ adapt.json 已就緒\n");
  console.log(`📋 coding-standard 規則數：${codingStandard.length}`);
  console.log(`📋 git-flow 類型：${gitFlow.flowType || "（未設定）"}`);
  console.log(`📋 labels 數量：${labels.length}`);

  if (adapt.meta?.updatedAt) {
    console.log(`📋 最後更新：${adapt.meta.updatedAt}`);
  }

  const schemaExists = getSchemaTargetPaths().some((p) => existsSync(p));
  console.log(
    `📋 project-schema skill：${schemaExists ? "已存在" : "尚未生成"}`,
  );

  const reportExists = existsSync(REPORT_FILE);
  console.log(
    `📋 misnamed-file-report：${reportExists ? "已存在" : "尚未生成"}`,
  );

  return {
    ok: true,
    codingStandardCount: codingStandard.length,
    gitFlowType: gitFlow.flowType || null,
    labelsCount: labels.length,
  };
}

function cmdListFiles(args) {
  const format = args.format === "json" ? "json" : "text";
  const dirsArg = typeof args.dirs === "string" ? args.dirs : "";
  const startDirs = dirsArg
    ? dirsArg
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : ["."];

  const allFiles = [];
  for (const dir of startDirs) {
    const absDir = join(projectRoot, dir);
    const files = walkFiles(absDir);
    allFiles.push(...files);
  }

  const uniqueFiles = [...new Set(allFiles)].sort();

  if (format === "json") {
    console.log(
      JSON.stringify(
        { count: uniqueFiles.length, files: uniqueFiles },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`📁 可分析檔案數：${uniqueFiles.length}\n`);
  for (const f of uniqueFiles) {
    console.log(f);
  }
}

function cmdFileHistory(args) {
  const filePath = args.path;
  if (!filePath || typeof filePath !== "string") {
    throw new Error("請提供 --path=<file-path>");
  }

  const max = Number(args.max) > 0 ? Number(args.max) : 30;
  const absPath = join(projectRoot, filePath);

  if (!existsSync(absPath)) {
    throw new Error(`檔案不存在：${filePath}`);
  }

  const logFormat = "%H|%s|%an|%ad";
  const raw = exec(
    `git log --follow --max-count=${max} --date=short --format="${logFormat}" -- "${filePath}"`,
    { silent: true, throwOnError: false },
  );

  if (!raw) {
    console.log(JSON.stringify({ path: filePath, commits: [] }, null, 2));
    return;
  }

  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split("|");
      const tickets = extractTickets(subject || "");
      return { hash, subject, author, date, tickets };
    });

  const allTickets = [...new Set(commits.flatMap((c) => c.tickets))];

  const output = {
    path: filePath,
    commitCount: commits.length,
    tickets: allTickets,
    commits,
  };

  console.log(JSON.stringify(output, null, 2));
}

function cmdDeclarationHistory(args) {
  const filePath = args.path;
  const signature = args.signature || args.query;
  const max = Number(args.max) > 0 ? Number(args.max) : 50;

  if (!filePath || typeof filePath !== "string") {
    throw new Error("請提供 --path=<file-path>");
  }
  if (!signature || typeof signature !== "string") {
    throw new Error("請提供 --signature=<declaration-signature>");
  }

  const absPath = join(projectRoot, filePath);
  if (!existsSync(absPath)) {
    throw new Error(`檔案不存在：${filePath}`);
  }

  const escapedSignature = signature.replace(/"/g, '\\"');
  const raw = exec(
    `git log --reverse --max-count=${max} --date=short --format="%H|%s|%an|%ad" -S "${escapedSignature}" -- "${filePath}"`,
    { silent: true, throwOnError: false },
  );

  if (!raw) {
    console.log(
      JSON.stringify(
        {
          path: filePath,
          signature,
          commitCount: 0,
          origin: null,
          commits: [],
        },
        null,
        2,
      ),
    );
    return;
  }

  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split("|");
      const tickets = extractTickets(subject || "");
      return {
        hash,
        subject,
        author,
        date,
        tickets,
        isNoise: isNoiseCommitSubject(subject || ""),
      };
    });

  const preferredOrigin =
    commits.find((c) => !c.isNoise && c.tickets.length > 0) ||
    commits.find((c) => !c.isNoise) ||
    commits[0];

  const output = {
    path: filePath,
    signature,
    commitCount: commits.length,
    origin: preferredOrigin
      ? {
          hash: preferredOrigin.hash,
          subject: preferredOrigin.subject,
          tickets: preferredOrigin.tickets,
          isNoise: preferredOrigin.isNoise,
        }
      : null,
    commits,
  };

  console.log(JSON.stringify(output, null, 2));
}

function getAnnotationAuditFiles(args) {
  const dirsArg = typeof args.dirs === "string" ? args.dirs : "";
  const startDirs = dirsArg
    ? dirsArg
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : ["src"];

  const allFiles = [];
  for (const dir of startDirs) {
    const absDir = join(projectRoot, dir);
    const files = walkFiles(absDir);
    allFiles.push(...files);
  }

  return [...new Set(allFiles)]
    .filter((filePath) =>
      ANNOTATION_AUDIT_EXTENSIONS.has(extname(filePath).toLowerCase()),
    )
    .sort();
}

function parseJsdocBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() !== "/**") {
      i++;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "*/") {
      j++;
    }
    if (j >= lines.length) break;

    blocks.push({ start: i, end: j, lines: lines.slice(i, j + 1) });
    i = j + 1;
  }
  return blocks;
}

function dedupeExternalLinesInBlocks(lines) {
  const blocks = parseJsdocBlocks(lines);
  if (!blocks.length) {
    return { lines, removedCount: 0 };
  }

  const externalLinePattern =
    /^\s*\*\s*@external\s+https:\/\/innotech\.atlassian\.net\/browse\/[A-Z]+-\d+\s*$/;

  let removedCount = 0;
  const output = [...lines];

  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b];
    const seen = new Set();
    const next = [];
    for (const line of block.lines) {
      if (!externalLinePattern.test(line)) {
        next.push(line);
        continue;
      }
      const normalized = line.trim();
      if (seen.has(normalized)) {
        removedCount++;
        continue;
      }
      seen.add(normalized);
      next.push(line);
    }
    output.splice(block.start, block.end - block.start + 1, ...next);
  }

  return { lines: output, removedCount };
}

function buildTopFilePurposeBlock(relPath, tickets = []) {
  const ticketLines = Array.isArray(tickets)
    ? [...new Set(tickets)]
        .filter(Boolean)
        .slice(0, 5)
        .map((ticket) => ` * @external https://innotech.atlassian.net/browse/${ticket}`)
    : [];
  return [
    "/**",
    " * === 檔案用途區塊 ===",
    " * @module script-runtime",
    ` * @purpose 管理 ${relPath} 的註解補全與用途說明`,
    ...ticketLines,
    " */",
    "",
  ].join("\n");
}

function buildMiddleDeclarationSectionBlock() {
  return [
    "/**",
    " * === 宣告內容用途說明與單號關聯 ===",
    " * @description 本區塊以下宣告需標示用途與單號關聯",
    " * @purpose 統一定義宣告級註解格式與單號追溯規則",
    " */",
    "",
  ].join("\n");
}

function ensureThreeSectionAnnotationLayout(
  content,
  { relPath, hasDeclarations, fileTickets },
) {
  let next = String(content || "").replace(/^\uFEFF/, "");
  let shebang = "";
  if (next.startsWith("#!")) {
    const firstNewline = next.indexOf("\n");
    if (firstNewline >= 0) {
      shebang = next.slice(0, firstNewline + 1);
      next = next.slice(firstNewline + 1);
    } else {
      shebang = `${next}\n`;
      next = "";
    }
  }
  const topPattern = /^\s*\/\*\*[\s\S]*?=== 檔案用途區塊 ===[\s\S]*?\*\/\s*/;
  const middlePattern = /\/\*\*[\s\S]*?=== 宣告內容用途說明與單號關聯 ===[\s\S]*?\*\/\s*/;

  if (!topPattern.test(next)) {
    next = `${buildTopFilePurposeBlock(relPath, fileTickets)}${next.replace(/^\s*/, "")}`;
  }

  if (hasDeclarations && !middlePattern.test(next)) {
    const topMatch = next.match(topPattern);
    const insertPos = topMatch ? topMatch[0].length : 0;
    next = `${next.slice(0, insertPos)}${buildMiddleDeclarationSectionBlock()}${next.slice(insertPos)}`;
  }

  return `${shebang}${next}`;
}

function normalizeExternalTicketLinksDetailed(
  content,
  { removeUnknown = true } = {},
) {
  const text = String(content || "");
  const lines = text.split("\n");
  const normalizedLines = [];
  const validPattern =
    /^(\s*\*\s*)@external\s+https:\/\/innotech\.atlassian\.net\/browse\/([A-Z]+-\d+)\s*$/;
  const externalPattern = /^(\s*\*\s*)@external\b/;
  let normalizedCount = 0;
  let removedCount = 0;

  for (const line of lines) {
    if (!externalPattern.test(line)) {
      normalizedLines.push(line);
      continue;
    }

    const validMatch = line.match(validPattern);
    if (validMatch) {
      const prefix = validMatch[1];
      const ticket = validMatch[2];
      const canonical = `${prefix}@external https://innotech.atlassian.net/browse/${ticket}`;
      normalizedLines.push(canonical);
      if (canonical !== line) normalizedCount++;
      continue;
    }

    const ticketMatch = line.match(/\b([A-Z]+-\d+)\b/);
    if (ticketMatch) {
      const prefix = (line.match(externalPattern) || [])[1] || " * ";
      const ticket = ticketMatch[1];
      normalizedLines.push(
        `${prefix}@external https://innotech.atlassian.net/browse/${ticket}`,
      );
      normalizedCount++;
      continue;
    }

    if (removeUnknown) {
      removedCount++;
      continue;
    }

    normalizedLines.push(line);
  }

  const normalizedContent = normalizedLines.join("\n");
  return {
    content: normalizedContent,
    normalizedCount,
    removedCount,
  };
}

function normalizeExternalTicketLinks(content, options) {
  return normalizeExternalTicketLinksDetailed(content, options).content;
}

function collectInvalidExternalLines(content) {
  const lines = String(content || "").split("\n");
  const invalid = [];
  const externalPattern = /^\s*\*\s*@external\b/;
  const validPattern =
    /^\s*\*\s*@external\s+https:\/\/innotech\.atlassian\.net\/browse\/[A-Z]+-\d+\s*$/;
  for (const line of lines) {
    if (!externalPattern.test(line)) continue;
    if (!validPattern.test(line)) invalid.push(line.trim());
  }
  return invalid;
}

function upsertBottomLlmRecordBlock(content, { model, summary }) {
  const normalized = String(content || "").replace(/\s+$/, "");
  const cleanedSummary = String(summary || "annotation updated by evolve")
    .replace(/\s+/g, " ")
    .trim();
  const timestamp = new Date().toISOString();
  const bottomBlockPattern =
    /\n?\/\*\*\n \* === llm 分析紀錄區 ===[\s\S]*?\n \*\/\s*$/;
  const withoutOldBlock = normalized.replace(bottomBlockPattern, "");
  const note =
    cleanedSummary || "Full JS declaration-level compliance recheck completed.";
  const newBlock = [
    "",
    "/**",
    " * === llm 分析紀錄區 ===",
    ` * @llm-review-submitted-at ${timestamp}`,
    ` * @llm-review-model ${model}`,
    ` * @llm-review-note ${note}`,
    " */",
    "",
  ].join("\n");
  return `${withoutOldBlock}${newBlock}`;
}

function removeDuplicateBottomLlmBlocks(content) {
  const lines = String(content || "").split("\n");
  const blocks = parseJsdocBlocks(lines);
  const llmBlocks = blocks.filter((block) =>
    block.lines.some((line) => /=== llm 分析紀錄區 ===/.test(line)),
  );
  if (llmBlocks.length <= 1) {
    return { content: String(content || ""), removedCount: 0 };
  }

  const output = [...lines];
  for (let i = llmBlocks.length - 2; i >= 0; i--) {
    const block = llmBlocks[i];
    output.splice(block.start, block.end - block.start + 1);
  }

  return {
    content: output.join("\n"),
    removedCount: llmBlocks.length - 1,
  };
}

function validateAnnotationSectionFormat(content, hasDeclarations) {
  const text = String(content || "");
  const topBlockPattern =
    /^(#![^\n]*\n\s*)?\/\*\*[\s\S]*?檔案用途區塊[\s\S]*?@purpose[\s\S]*?\*\/\s*/;
  const declarationPattern =
    /宣告內容用途說明與單號關聯[\s\S]*?@description[\s\S]*?@purpose/;
  const bottomBlockPattern =
    /\/\*\*[\s\S]*?=== llm 分析紀錄區 ===[\s\S]*?@llm-review-submitted-at[\s\S]*?@llm-review-model[\s\S]*?@llm-review-note[\s\S]*?\*\/\s*$/;

  const missing = [];
  if (!topBlockPattern.test(text)) {
    missing.push("檔案用途區塊");
  }
  if (hasDeclarations && !declarationPattern.test(text)) {
    missing.push("宣告內容用途說明與單號關聯");
  }
  if (!bottomBlockPattern.test(text.trim())) {
    missing.push("llm 分析紀錄區");
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

function cmdAnnotationAudit(args) {
  const format = args.format === "text" ? "text" : "json";
  const shouldFix = args.fix === true || args.fix === "true";
  const outputFile =
    typeof args["output-file"] === "string" ? args["output-file"] : null;

  const files = getAnnotationAuditFiles(args);
  const issues = [];
  const issueCounts = {
    emptyTopComment: 0,
    templatePurpose: 0,
    duplicateExternal: 0,
    duplicateReviewBlock: 0,
    malformedDelimiter: 0,
  };

  const fixSummary = {
    enabled: shouldFix,
    filesChanged: 0,
    duplicateExternalRemoved: 0,
    delimiterNormalized: 0,
    duplicateReviewRemoved: 0,
  };

  for (const relPath of files) {
    const absPath = join(projectRoot, relPath);
    const original = readFileSync(absPath, "utf-8");
    let content = original;
    const lines = content.split("\n");
    const fileIssues = [];

    // 1) Empty top file JSDoc block.
    let firstContentLine = 0;
    while (
      firstContentLine < lines.length &&
      lines[firstContentLine].trim() === ""
    ) {
      firstContentLine++;
    }
    if (
      firstContentLine + 1 < lines.length &&
      lines[firstContentLine].trim() === "/**" &&
      lines[firstContentLine + 1].trim() === "*/"
    ) {
      fileIssues.push("emptyTopComment");
      issueCounts.emptyTopComment++;
    }

    // 2) Template purpose.
    const templatePurposePattern =
      /@purpose\s+(Provide declaration logic for|Retrieve data for)\b/g;
    if (templatePurposePattern.test(content)) {
      fileIssues.push("templatePurpose");
      issueCounts.templatePurpose++;
    }

    // 3) Duplicate review blocks.
    const reviewBlockCount = (content.match(/@llm-review-submitted-at/g) || [])
      .length;
    if (reviewBlockCount > 1) {
      fileIssues.push("duplicateReviewBlock");
      issueCounts.duplicateReviewBlock++;
    }

    // 4) Malformed duplicated delimiters.
    const malformedBefore =
      (content.match(/\/\*\*\s*\n\s*\/\*\*/g) || []).length +
      (content.match(/\*\/\s*\n\s*\*\//g) || []).length;
    if (malformedBefore > 0) {
      fileIssues.push("malformedDelimiter");
      issueCounts.malformedDelimiter++;
    }

    // 5) Duplicate @external in same block.
    const blocks = parseJsdocBlocks(lines);
    let duplicateExternalFound = false;
    const externalLinePattern =
      /^\s*\*\s*@external\s+https:\/\/innotech\.atlassian\.net\/browse\/[A-Z]+-\d+\s*$/;
    for (const block of blocks) {
      const seen = new Set();
      for (const line of block.lines) {
        if (!externalLinePattern.test(line)) continue;
        const normalized = line.trim();
        if (seen.has(normalized)) {
          duplicateExternalFound = true;
          break;
        }
        seen.add(normalized);
      }
      if (duplicateExternalFound) break;
    }
    if (duplicateExternalFound) {
      fileIssues.push("duplicateExternal");
      issueCounts.duplicateExternal++;
    }

    if (shouldFix) {
      let changed = false;

      // Safe fix A: normalize duplicated JSDoc delimiters.
      const normalized = content
        .replace(/\/\*\*\s*\n\s*\/\*\*\s*\n/g, "/**\n")
        .replace(/\*\/\s*\n\s*\*\/\s*\n/g, "*/\n");
      if (normalized !== content) {
        content = normalized;
        changed = true;
        fixSummary.delimiterNormalized++;
      }

      // Safe fix B: dedupe @external in same block.
      const dedupeResult = dedupeExternalLinesInBlocks(content.split("\n"));
      if (dedupeResult.removedCount > 0) {
        content = dedupeResult.lines.join("\n");
        changed = true;
        fixSummary.duplicateExternalRemoved += dedupeResult.removedCount;
      }

      // Safe fix C: keep only one bottom llm review block.
      // Skip self-fixing evolve.mjs to avoid mutating rule/template strings.
      if (!relPath.endsWith("utilities/evolve.mjs")) {
        const reviewFix = removeDuplicateBottomLlmBlocks(content);
        if (reviewFix.removedCount > 0) {
          content = reviewFix.content;
          changed = true;
          fixSummary.duplicateReviewRemoved += reviewFix.removedCount;
        }
      }

      if (changed && content !== original) {
        writeFileSync(absPath, content, "utf-8");
        fixSummary.filesChanged++;
      }
    }

    if (fileIssues.length > 0) {
      issues.push({
        path: relPath,
        issues: fileIssues,
      });
    }
  }

  const report = {
    scannedFiles: files.length,
    issueFileCount: issues.length,
    issueCounts,
    fixSummary,
    files: issues,
  };

  if (outputFile) {
    const reportPath = join(projectRoot, outputFile);
    ensureDirForFile(reportPath);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  }

  if (format === "text") {
    console.log(`📊 掃描檔案數: ${report.scannedFiles}`);
    console.log(`📊 有問題檔案數: ${report.issueFileCount}`);
    console.log(
      `📋 問題統計: emptyTop=${issueCounts.emptyTopComment}, templatePurpose=${issueCounts.templatePurpose}, duplicateExternal=${issueCounts.duplicateExternal}, duplicateReview=${issueCounts.duplicateReviewBlock}, malformedDelimiter=${issueCounts.malformedDelimiter}`,
    );
    if (shouldFix) {
      console.log(
        `🛠️  修復結果: filesChanged=${fixSummary.filesChanged}, duplicateExternalRemoved=${fixSummary.duplicateExternalRemoved}, delimiterNormalized=${fixSummary.delimiterNormalized}, duplicateReviewRemoved=${fixSummary.duplicateReviewRemoved}`,
      );
    }
    for (const file of issues.slice(0, 200)) {
      console.log(`- ${file.path}: ${file.issues.join(", ")}`);
    }
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function cmdFixExternalLinks(args) {
  const format = args.format === "text" ? "text" : "json";
  const dryRun = args["dry-run"] === true || args["dry-run"] === "true";
  const files = getAnnotationAuditFiles(args);
  const report = {
    scannedFiles: files.length,
    updatedFiles: 0,
    unchangedFiles: 0,
    dryRun,
    normalizedExternalCount: 0,
    removedExternalCount: 0,
    files: [],
  };

  for (const relPath of files) {
    const absPath = join(projectRoot, relPath);
    const before = readFileSync(absPath, "utf-8");
    const fixed = normalizeExternalTicketLinksDetailed(before, {
      removeUnknown: true,
    });
    const after = fixed.content;

    report.normalizedExternalCount += fixed.normalizedCount;
    report.removedExternalCount += fixed.removedCount;

    if (after === before) {
      report.unchangedFiles++;
      report.files.push({ path: relPath, status: "unchanged" });
      continue;
    }

    if (!dryRun) {
      writeFileSync(absPath, after, "utf-8");
    }
    report.updatedFiles++;
    report.files.push({
      path: relPath,
      status: dryRun ? "would-update" : "updated",
      normalizedExternalCount: fixed.normalizedCount,
      removedExternalCount: fixed.removedCount,
    });
  }

  if (format === "text") {
    console.log(`📊 scanned: ${report.scannedFiles}`);
    console.log(`✅ updated: ${report.updatedFiles}`);
    console.log(`⏭️ unchanged: ${report.unchangedFiles}`);
    console.log(`🔧 normalized @external: ${report.normalizedExternalCount}`);
    console.log(`🗑️ removed invalid @external: ${report.removedExternalCount}`);
    for (const file of report.files.slice(0, 200)) {
      if (file.status === "unchanged") continue;
      console.log(
        `- ${file.path}: ${file.status} (normalized=${file.normalizedExternalCount}, removed=${file.removedExternalCount})`,
      );
    }
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

async function cmdRunAnnotationPass(args) {
  const format = args.format === "text" ? "text" : "json";
  const dryRun = args["dry-run"] === true || args["dry-run"] === "true";
  const maxFiles =
    Number(args["max-files"]) > 0 ? Number(args["max-files"]) : 200;
  const envLocal = loadEnvLocal();
  const model = resolveLlmModel({
    explicitModel: typeof args.model === "string" ? args.model : null,
    envLocal,
    envKeys: ["EVOLVE_ANNOTATION_MODEL", "ADAPT_LLM_MODEL", "OPENAI_MODEL"],
    defaultModel: "gpt-5.3-codex",
  });

  const files = getAnnotationAuditFiles(args).slice(0, maxFiles);
  const openaiApiKey = process.env.OPENAI_API_KEY || envLocal.OPENAI_API_KEY || null;
  const llmProviderInput = String(
    args["llm-provider"] ||
      process.env.EVOLVE_LLM_PROVIDER ||
      envLocal.EVOLVE_LLM_PROVIDER ||
      "auto",
  )
    .trim()
    .toLowerCase();
  let llmProvider =
    llmProviderInput === "openai" || llmProviderInput === "api-domain"
      ? llmProviderInput
      : llmProviderInput === "openai-domain" || llmProviderInput === "domain"
        ? "api-domain"
        : openaiApiKey
          ? "openai"
          : "api-domain";
  if (
    llmProviderInput &&
    !["auto", "openai", "api-domain", "openai-domain", "domain"].includes(
      llmProviderInput,
    )
  ) {
    console.log(`⚠️  未知 llm-provider: ${llmProviderInput}，改用 ${llmProvider}`);
  }
  const customOpenAiApiUrl =
    (typeof args["api-domain"] === "string" && args["api-domain"].trim()) ||
    process.env.CUSTOM_OPENAI_API_URL ||
    envLocal.CUSTOM_OPENAI_API_URL ||
    "http://service-hub-ai.balinese-python.ts.net/v1";
  if (llmProvider === "openai" && !openaiApiKey) {
    llmProvider = "api-domain";
    console.log("⚠️  缺少 OPENAI_API_KEY，evolve 將改用 CUSTOM_OPENAI_API_URL");
  }
  const requestedLlmTimeoutMs = Number(args["llm-timeout-ms"]);
  const llmTimeoutMs =
    Number.isFinite(requestedLlmTimeoutMs) && requestedLlmTimeoutMs > 0
      ? requestedLlmTimeoutMs
      : 120000;
  const requestedTemperature = Number(args.temperature);
  const temperature = Number.isFinite(requestedTemperature)
    ? requestedTemperature
    : model.startsWith("gpt-5")
      ? 1
      : 0.2;

  const report = {
    scannedFiles: files.length,
    updatedFiles: 0,
    skippedFiles: 0,
    rejectedBySafetyGate: 0,
    failedFiles: 0,
    dryRun,
    model,
    llmProvider,
    files: [],
  };

  for (const [index, relPath] of files.entries()) {
    const absPath = join(projectRoot, relPath);
    const before = readFileSync(absPath, "utf-8");
    const signatures = extractDeclarationSignatures(before);
    const declarationOrigins = getDeclarationOriginTickets(relPath, signatures);
    const historySubjects = getFileHistorySubjects(relPath, 20);
    const fileTickets = [
      ...new Set(historySubjects.flatMap((subject) => extractTickets(subject || ""))),
    ];

    try {
      console.log(
        `⏳ [${index + 1}/${files.length}] 處理中: ${relPath} (timeout=${llmTimeoutMs}ms)`,
      );
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["updatedContent", "summary"],
        properties: {
          updatedContent: { type: "string" },
          summary: { type: "string" },
        },
      };

      const llmResp = await Promise.race([
        callOpenAiJson({
          model,
          system:
            "You are an annotation refactoring engine. Return ONLY JSON. " +
            "You must only update comments. Do not change runtime logic. " +
            "For JavaScript/TypeScript files, enforce a three-section annotation layout: " +
            "top block must contain title '檔案用途區塊' and use @module/@purpose/@external style, " +
            "middle declaration blocks must contain title '宣告內容用途說明與單號關聯' and use @description/@purpose/@external style, " +
            "bottom block must contain title 'llm 分析紀錄區' with @llm-review-submitted-at/@llm-review-model/@llm-review-note. " +
            "For declaration comments, use declaration origin tickets from input.declarationOrigins only. " +
            "If no tickets for a declaration, omit @external. " +
            "Every @external must use full Jira browse URL format: https://innotech.atlassian.net/browse/<TICKET>. " +
            "Avoid template purpose phrases like 'Provide declaration logic for'.",
          input: {
            path: relPath,
            content: before,
            fileHistorySubjects: historySubjects,
            declarationOrigins,
            requirements: {
              topCommentRequired: true,
              declarationCommentRequired: true,
              omitExternalWhenNoTicket: true,
              dedupeExternalInBlock: true,
              removeMalformedJsdocDelimiters: true,
              keepRuntimeLogicUnchanged: true,
              sectionLayout: {
                top: "檔案用途區塊",
                middle: "宣告內容用途說明與單號關聯",
                bottom: "llm 分析紀錄區",
              },
              mrStyleTags: {
                top: ["@module", "@purpose", "@external"],
                declaration: ["@description", "@purpose", "@external"],
                bottom: [
                  "@llm-review-submitted-at",
                  "@llm-review-model",
                  "@llm-review-note",
                ],
              },
            },
          },
          schema,
          schemaName: "evolve_annotation_pass_result",
          temperature,
          apiKey: llmProvider === "openai" ? openaiApiKey : null,
          customOpenAiApiUrl:
            llmProvider === "api-domain" ? customOpenAiApiUrl : null,
          forceCompassProxy: false,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`llm-timeout(${llmTimeoutMs}ms): ${relPath}`)),
            llmTimeoutMs,
          ),
        ),
      ]);

      const updatedContent = String(llmResp.updatedContent || "");
      if (!updatedContent.trim()) {
        report.failedFiles++;
        report.files.push({
          path: relPath,
          status: "failed",
          reason: "llm-empty-output",
        });
        continue;
      }

      const withThreeSections = ensureThreeSectionAnnotationLayout(
        updatedContent,
        {
          relPath,
          hasDeclarations: signatures.length > 0,
          fileTickets,
        },
      );
      const withNormalizedExternal = normalizeExternalTicketLinks(withThreeSections);
      const withBottomRecord = upsertBottomLlmRecordBlock(withNormalizedExternal, {
        model,
        summary: llmResp.summary || "",
      });
      const invalidExternalLines = collectInvalidExternalLines(withBottomRecord);
      if (invalidExternalLines.length > 0) {
        report.rejectedBySafetyGate++;
        report.files.push({
          path: relPath,
          status: "rejected",
          reason: `external-link-format-invalid: ${invalidExternalLines.slice(0, 3).join(" | ")}`,
        });
        continue;
      }
      const sectionValidation = validateAnnotationSectionFormat(
        withBottomRecord,
        signatures.length > 0,
      );
      if (!sectionValidation.ok) {
        report.rejectedBySafetyGate++;
        report.files.push({
          path: relPath,
          status: "rejected",
          reason: `annotation-section-missing: ${sectionValidation.missing.join(", ")}`,
        });
        continue;
      }

      if (!isCommentOnlyChange(before, withBottomRecord)) {
        report.rejectedBySafetyGate++;
        report.files.push({
          path: relPath,
          status: "rejected",
          reason: "safety-gate-non-comment-change",
        });
        continue;
      }

      if (withBottomRecord === before) {
        report.skippedFiles++;
        report.files.push({ path: relPath, status: "unchanged" });
        continue;
      }

      if (!dryRun) {
        writeFileSync(absPath, withBottomRecord, "utf-8");
      }

      report.updatedFiles++;
      report.files.push({
        path: relPath,
        status: dryRun ? "would-update" : "updated",
        summary: llmResp.summary || "",
      });
    } catch (error) {
      report.failedFiles++;
      report.files.push({
        path: relPath,
        status: "failed",
        reason: error?.message || String(error),
      });
    }
  }

  if (format === "text") {
    console.log(`📊 scanned: ${report.scannedFiles}`);
    console.log(`✅ updated: ${report.updatedFiles}`);
    console.log(`⏭️ skipped: ${report.skippedFiles}`);
    console.log(`🛡️ rejected(safety): ${report.rejectedBySafetyGate}`);
    console.log(`❌ failed: ${report.failedFiles}`);
    for (const row of report.files.slice(0, 200)) {
      console.log(
        `- ${row.path}: ${row.status}${row.reason ? ` (${row.reason})` : ""}`,
      );
    }
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function cmdWriteSchema(args) {
  const schema = readJsonInput(args.input, args["input-file"]);
  const content = renderSchemaSkill(schema);
  const targets = getSchemaTargetPaths();

  let updatedCount = 0;
  let skippedCount = 0;

  for (const targetPath of targets) {
    if (existsSync(targetPath)) {
      const existing = readFileSync(targetPath, "utf-8");
      if (
        !existing.includes(SCHEMA_SKILL.managedMarker) &&
        existing !== content
      ) {
        console.log(
          `⚠️  偵測到既有自訂 skill：${targetPath}，為避免覆蓋使用者內容，本次跳過更新`,
        );
        skippedCount++;
        continue;
      }
    }

    ensureDirForFile(targetPath);
    writeFileSync(targetPath, content, "utf-8");
    console.log(`✅ 已寫入：${relative(projectRoot, targetPath)}`);
    updatedCount++;
  }

  ensureEvolveTmpDir();
  writeFileSync(
    join(EVOLVE_TMP_DIR, "project-schema.json"),
    JSON.stringify(schema, null, 2),
    "utf-8",
  );

  console.log(
    `\n📊 project-schema 落地完成：更新 ${updatedCount} 個目標，跳過 ${skippedCount} 個`,
  );
}

function cmdWriteReport(args) {
  const analysis = readJsonInput(args.input, args["input-file"]);
  const content = renderMisnamedReport(analysis);

  writeFileSync(REPORT_FILE, content, "utf-8");
  console.log(`✅ 已寫入：${relative(projectRoot, REPORT_FILE)}`);

  const files = Array.isArray(analysis.files) ? analysis.files : [];
  const misnamed = files.filter((f) => f.nameMatchesPurpose === false);
  console.log(`📊 分析檔案數：${files.length}，命名問題：${misnamed.length}`);
}

function updateImportsInFile(filePath, fromPath, toPath) {
  if (!existsSync(filePath) || !isAnalyzableFile(filePath)) return false;

  const fromBase = basename(fromPath, extname(fromPath));
  const toBase = basename(toPath, extname(toPath));
  const fromNoExt = fromPath.replace(/\.[^.]+$/, "");
  const toNoExt = toPath.replace(/\.[^.]+$/, "");

  let content = readFileSync(filePath, "utf-8");
  const original = content;

  const patterns = [
    [fromPath, toPath],
    [fromNoExt, toNoExt],
    [fromBase, toBase],
  ];

  for (const [from, to] of patterns) {
    if (from === to) continue;
    content = content.split(from).join(to);
  }

  if (content !== original) {
    writeFileSync(filePath, content, "utf-8");
    return true;
  }
  return false;
}

function cmdRename(args) {
  const plan = readJsonInput(args.input, args["input-file"]);
  const renames = Array.isArray(plan.renames) ? plan.renames : [];
  const dryRun = args["dry-run"] === true || args["dry-run"] === "true";

  if (!renames.length) {
    throw new Error("rename plan 的 renames 陣列為空");
  }

  const allFiles = walkFiles(projectRoot);
  const results = [];

  for (const item of renames) {
    const from = item.from;
    const to = item.to;
    if (!from || !to) {
      throw new Error("每個 rename 項目需要 from 與 to");
    }

    const fromAbs = join(projectRoot, from);
    const toAbs = join(projectRoot, to);

    if (!existsSync(fromAbs)) {
      throw new Error(`來源檔案不存在：${from}`);
    }
    if (existsSync(toAbs) && fromAbs !== toAbs) {
      throw new Error(`目標檔案已存在：${to}`);
    }

    if (dryRun) {
      console.log(`[dry-run] git mv ${from} → ${to}`);
      results.push({ from, to, status: "dry-run" });
      continue;
    }

    ensureDirForFile(toAbs);
    exec(`git mv "${from}" "${to}"`, { silent: true });

    let updatedImports = 0;
    for (const f of allFiles) {
      if (f === from || f === to) continue;
      const abs = join(projectRoot, f);
      if (updateImportsInFile(abs, from, to)) {
        updatedImports++;
      }
    }

    console.log(
      `✅ 已重新命名：${from} → ${to}（更新 ${updatedImports} 個檔案的引用）`,
    );
    results.push({ from, to, status: "done", updatedImports });
  }

  if (dryRun) {
    console.log(`\n📊 [dry-run] 共 ${results.length} 個重新命名待執行`);
  } else {
    console.log(`\n📊 重新命名完成：${results.length} 個檔案`);
  }
}

function cmdStatus() {
  ensureEvolveTmpDir();

  const status = {
    adaptJson: existsSync(ADAPT_FILE),
    projectSchema: getSchemaTargetPaths().some((p) => existsSync(p)),
    misnamedReport: existsSync(REPORT_FILE),
    progressFile: existsSync(PROGRESS_FILE),
    schemaDraft: existsSync(join(EVOLVE_TMP_DIR, "project-schema.json")),
  };

  if (status.progressFile) {
    const progress = safeJsonParse(
      readFileSync(PROGRESS_FILE, "utf-8"),
      "analysis-progress.json",
    );
    const files = Array.isArray(progress.files) ? progress.files : [];
    const done = files.filter((f) => f.analyzed).length;
    status.analyzedFiles = done;
    status.totalFiles = files.length;
  }

  console.log(JSON.stringify(status, null, 2));
}

function printHelp() {
  console.log(`evolve.mjs - Operator Agent 生態演化工具

Subcommands:
  check-prereq                     檢查 adapt.json 是否存在
  list-files [--dirs=a,b]          列出可分析檔案
                 [--format=json]
  file-history --path=<path>       查詢檔案 git history 與工單號
                 [--max=30]
  declaration-history --path=<path> --signature="<text>"
                 [--max=50]        查詢宣告級來源 commit 與工單號
  annotation-audit [--dirs=a,b]
                 [--fix=true]      註解品質稽核（可選安全自動修復）
                 [--output-file=.evolve-tmp/annotation-audit.json]
                 [--format=json|text]
  run-annotation-pass [--dirs=a,b]
                 [--max-files=200]
                 [--model=gpt-5.3-codex]
                 [--llm-provider=openai|api-domain]
                 [--api-domain=<url>]
                 [--llm-timeout-ms=120000]
                 [--dry-run=true]
                 [--format=json|text]
                 由 Pantheon agent 直接呼叫 LLM 逐檔補註解（含 comments-only 安全閘）
  fix-external-links [--dirs=a,b]
                 [--dry-run=true]
                 [--format=json|text]
                 僅修正 @external：可判斷 ticket 則轉 Jira hyperlink，無 ticket 則移除
  write-schema --input-file=<json> 生成 project-schema SKILL.md
  write-report --input-file=<json> 生成 misnamed-file-report.md
  rename --input-file=<json>       執行重新命名
         [--dry-run]
  status                           顯示 evolve 進度狀態

Examples:
  node evolve.mjs check-prereq
  node evolve.mjs list-files --dirs=src,.cursor --format=json
  node evolve.mjs file-history --path=src/foo.ts --max=20
  node evolve.mjs declaration-history --path=src/foo.ts --signature="const foo ="
  node evolve.mjs annotation-audit --dirs=src --format=text
  node evolve.mjs annotation-audit --dirs=src --fix=true --output-file=.evolve-tmp/annotation-audit.json
  node evolve.mjs run-annotation-pass --dirs=src --max-files=50 --dry-run=true --format=text
  node evolve.mjs write-schema --input-file=.evolve-tmp/project-schema.json
  node evolve.mjs write-report --input-file=.evolve-tmp/analysis-progress.json
  node evolve.mjs rename --input-file=.evolve-tmp/rename-plan.json --dry-run
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "check-prereq":
      cmdCheckPrereq();
      break;
    case "list-files":
      cmdListFiles(args);
      break;
    case "file-history":
      cmdFileHistory(args);
      break;
    case "declaration-history":
      cmdDeclarationHistory(args);
      break;
    case "annotation-audit":
      cmdAnnotationAudit(args);
      break;
    case "run-annotation-pass":
      await cmdRunAnnotationPass(args);
      break;
    case "fix-external-links":
      cmdFixExternalLinks(args);
      break;
    case "write-schema":
      cmdWriteSchema(args);
      break;
    case "write-report":
      cmdWriteReport(args);
      break;
    case "rename":
      cmdRename(args);
      break;
    case "status":
      cmdStatus();
      break;
    default:
      console.error(`❌ 未知子命令：${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ evolve 執行失敗: ${error?.message || String(error)}`);
  process.exit(1);
});
/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T18:03:34.389Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note Inserted three-section annotation header blocks (檔案用途區塊 / 宣告內容用途說明與單號關聯 / llm 分析紀錄區) at the top of the file, preserving runtime logic.
 */

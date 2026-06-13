#!/usr/bin/env node

/**
 * evolve - Operator Agent ecosystem transformation utilities
 *
 * Subcommands:
 *   check-prereq          Verify adapt.json exists and output summary
 *   list-files            List analyzable source files
 *   file-history          Git history for a file with ticket extraction
 *   write-schema          Generate project-schema SKILL.md in target project root
 *   write-report          Generate misnamed-file-report.md in target project root
 *   rename                Execute file renames (supports --dry-run)
 *   status                Show evolve progress from target project .evolve-tmp/
 *
 * All generated artifacts (project-schema, misnamed-file-report, .evolve-tmp/)
 * are written to the target project via getProjectRoot(), not into Pantheon source.
 */

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { getProjectRoot } from "./env-loader.mjs";

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
      const paths = Array.isArray(m.paths) ? m.paths.map((p) => `- \`${p}\``).join("\n") : "";
      const deps = Array.isArray(m.dependencies) && m.dependencies.length
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

${misnamed.length === 0
    ? "未發現命名與用途不符的檔案。"
    : `共發現 ${misnamed.length} 個檔案命名與實際用途不符，建議重新命名。`}

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
  console.log(`📋 project-schema skill：${schemaExists ? "已存在" : "尚未生成"}`);

  const reportExists = existsSync(REPORT_FILE);
  console.log(`📋 misnamed-file-report：${reportExists ? "已存在" : "尚未生成"}`);

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
    ? dirsArg.split(",").map((d) => d.trim()).filter(Boolean)
    : ["."];

  const allFiles = [];
  for (const dir of startDirs) {
    const absDir = join(projectRoot, dir);
    const files = walkFiles(absDir);
    allFiles.push(...files);
  }

  const uniqueFiles = [...new Set(allFiles)].sort();

  if (format === "json") {
    console.log(JSON.stringify({ count: uniqueFiles.length, files: uniqueFiles }, null, 2));
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
    ? dirsArg.split(",").map((d) => d.trim()).filter(Boolean)
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

  // Reverse traversal to avoid index shift issues while splicing.
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

function cmdAnnotationAudit(args) {
  const format = args.format === "text" ? "text" : "json";
  const shouldFix = args.fix === true || args.fix === "true";
  const outputFile = typeof args["output-file"] === "string"
    ? args["output-file"]
    : null;

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
    const reviewBlockCount =
      (content.match(/@llm-review-submitted-at/g) || []).length;
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
        `🛠️  修復結果: filesChanged=${fixSummary.filesChanged}, duplicateExternalRemoved=${fixSummary.duplicateExternalRemoved}, delimiterNormalized=${fixSummary.delimiterNormalized}`,
      );
    }
    for (const file of issues.slice(0, 200)) {
      console.log(`- ${file.path}: ${file.issues.join(", ")}`);
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

    console.log(`✅ 已重新命名：${from} → ${to}（更新 ${updatedImports} 個檔案的引用）`);
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
  node evolve.mjs write-schema --input-file=.evolve-tmp/project-schema.json
  node evolve.mjs write-report --input-file=.evolve-tmp/analysis-progress.json
  node evolve.mjs rename --input-file=.evolve-tmp/rename-plan.json --dry-run
`);
}

function main() {
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

main();

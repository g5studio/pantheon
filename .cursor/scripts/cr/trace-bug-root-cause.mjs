#!/usr/bin/env node

/**
 * Bug root cause tracer — find commits that introduced the bug (not fix commits).
 *
 * Usage:
 *   node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234
 *   node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234 --target=main --format=markdown
 *   node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234 --json
 *   node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234 --files=src/a.ts,src/b.ts
 */

import { execSync } from "child_process";
import { getProjectRoot } from "../utilities/env-loader.mjs";

const projectRoot = getProjectRoot();

const TICKET_PATTERN = /\b([A-Z]+-\d+)\b/g;
const SKIP_SEARCH_TERMS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "return",
  "const",
  "let",
  "var",
  "if",
  "else",
  "function",
  "export",
  "import",
  "from",
  "default",
  "async",
  "await",
  "this",
  "void",
  "typeof",
  "new",
  "class",
  "interface",
  "type",
  "string",
  "number",
  "boolean",
  "any",
]);

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    ticket: null,
    target: "main",
    files: null,
    format: "markdown",
    maxCandidates: 5,
    maxTerms: 12,
    json: false,
  };

  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
      options.format = "json";
      continue;
    }
    if (arg.startsWith("--ticket=")) {
      options.ticket = arg.split("=").slice(1).join("=").trim().toUpperCase();
      continue;
    }
    if (arg.startsWith("--target=")) {
      options.target = arg.split("=").slice(1).join("=").trim();
      continue;
    }
    if (arg.startsWith("--files=")) {
      options.files = arg
        .split("=")
        .slice(1)
        .join("=")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.split("=").slice(1).join("=").trim().toLowerCase();
      continue;
    }
    if (arg.startsWith("--max-candidates=")) {
      options.maxCandidates = Number(arg.split("=")[1]) || 5;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
🔍 Bug Root Cause Tracer

Find commits that likely introduced a bug (excludes current fix branch commits).

Usage:
  node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234
  node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234 --target=main --format=markdown
  node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234 --json
  node .cursor/scripts/cr/trace-bug-root-cause.mjs --ticket=FE-1234 --files=src/a.ts,src/b.ts

Options:
  --ticket=FE-1234       Current Bug ticket (required; used to exclude fix commits)
  --target=main          Base branch for merge-base (default: main)
  --files=a.ts,b.ts      Limit to specific files (default: changed files vs target)
  --format=markdown|json Output format (default: markdown)
  --max-candidates=5     Max candidate commits to return
  --json                 Shorthand for --format=json
`.trim());
}

function execGit(command, { silent = true } = {}) {
  try {
    return execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
    }).trim();
  } catch (error) {
    if (!silent) {
      console.error(`Git error: ${error.message}`);
    }
    return "";
  }
}

function getMergeBase(targetBranch) {
  const remoteRef = `origin/${targetBranch}`;
  const hasRemote = execGit(`git rev-parse --verify ${remoteRef}`, {
    silent: true,
  });
  const ref = hasRemote ? remoteRef : targetBranch;
  return execGit(`git merge-base HEAD ${ref}`, { silent: true }) || null;
}

function getFixCommitHashes(baseCommit) {
  if (!baseCommit) return new Set();
  const log = execGit(`git log --format=%H ${baseCommit}..HEAD`, {
    silent: true,
  });
  return new Set(
    log
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function getChangedFiles(baseCommit, explicitFiles) {
  if (explicitFiles?.length) {
    return explicitFiles.filter((f) => execGit(`git ls-files -- ${f}`, { silent: true }));
  }

  const range = baseCommit ? `${baseCommit}...HEAD` : "HEAD";
  const nameStatus = execGit(`git diff --name-status ${range}`, { silent: true });
  const working = execGit("git diff --name-status", { silent: true });
  const staged = execGit("git diff --cached --name-status", { silent: true });

  const files = new Set();
  for (const block of [nameStatus, working, staged]) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const status = parts[0];
      if (status?.startsWith("D")) continue;
      const filePath = parts[parts.length - 1];
      if (filePath) files.add(filePath);
    }
  }

  return [...files].filter((f) => {
    const ext = f.split(".").pop()?.toLowerCase() || "";
    return !["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "lock"].includes(ext);
  });
}

function getUnifiedDiff(baseCommit, files) {
  if (!files.length) return "";
  const fileArgs = files.map((f) => `-- ${f}`).join(" ");
  const range = baseCommit ? `${baseCommit}...HEAD` : "";
  const committed = range
    ? execGit(`git diff ${range} ${fileArgs}`, { silent: true })
    : "";
  const working = execGit(`git diff ${fileArgs}`, { silent: true });
  const staged = execGit(`git diff --cached ${fileArgs}`, { silent: true });
  return [committed, working, staged].filter(Boolean).join("\n");
}

function extractSearchTerms(diffText, maxTerms) {
  const terms = new Map();
  const lines = String(diffText || "").split("\n");

  const addTerm = (raw, weight) => {
    const term = String(raw || "").trim();
    if (!term || term.length < 4 || term.length > 120) return;
    if (SKIP_SEARCH_TERMS.has(term.toLowerCase())) return;
    if (/^\d+$/.test(term)) return;
    const prev = terms.get(term) || 0;
    terms.set(term, prev + weight);
  };

  for (const line of lines) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;

    const content = line.slice(1).trim();
    if (!content || content.startsWith("//") || content.startsWith("*")) continue;

    const weight = line.startsWith("-") ? 3 : 2;

    const propertyChains = content.match(
      /[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*){1,6}/g,
    );
    for (const chain of propertyChains || []) {
      if (chain.split(".").length >= 2) addTerm(chain, weight + 2);
      const lastSegment = chain.split(".").pop();
      if (lastSegment && lastSegment.length >= 4) addTerm(lastSegment, weight);
    }

    const quoted = content.match(/['"`]([^'"`]{4,80})['"`]/g);
    for (const q of quoted || []) {
      addTerm(q.slice(1, -1), weight);
    }

    const identifiers = content.match(/[a-zA-Z_$][\w$]{3,}/g);
    for (const id of identifiers || []) {
      addTerm(id, weight);
    }
  }

  return [...terms.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term);
}

function extractTicketsFromText(text) {
  const found = new Set();
  const matches = String(text || "").matchAll(TICKET_PATTERN);
  for (const match of matches) {
    if (match[1]) found.add(match[1].toUpperCase());
  }
  return [...found];
}

function parseLogLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const space = trimmed.indexOf(" ");
  if (space <= 0) return null;
  return {
    hash: trimmed.slice(0, space),
    shortHash: trimmed.slice(0, Math.min(7, space)),
    subject: trimmed.slice(space + 1),
  };
}

function getCommitMeta(hash) {
  const authorDate = execGit(
    `git show -s --format=%ad ${hash} --date=short`,
    { silent: true },
  );
  const body = execGit(`git show -s --format=%B ${hash}`, { silent: true });
  const tickets = extractTicketsFromText(body);
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorDate: authorDate || "unknown",
    message: body.split("\n")[0] || "",
    tickets,
  };
}

function searchIntroducingCommits(term, file, excludeHashes, currentTicket) {
  const escaped = term.replace(/"/g, '\\"');
  const pickaxe = execGit(
    `git log -S "${escaped}" --format=%H %s --follow -- ${file}`,
    { silent: true },
  );
  const grep = execGit(
    `git log --grep="${escaped}" --format=%H %s -- ${file}`,
    { silent: true },
  );

  const candidates = [];
  const seen = new Set();

  for (const block of [pickaxe, grep]) {
    for (const line of block.split("\n")) {
      const parsed = parseLogLine(line);
      if (!parsed) continue;
      if (excludeHashes.has(parsed.hash)) continue;
      if (seen.has(parsed.hash)) continue;
      seen.add(parsed.hash);

      const meta = getCommitMeta(parsed.hash);
      const tickets = meta.tickets.filter((t) => t !== currentTicket);
      const isCurrentTicketOnly =
        meta.tickets.length === 1 && meta.tickets[0] === currentTicket;

      let score = 10;
      if (tickets.length) score += 20;
      if (isCurrentTicketOnly) score -= 30;
      if (block === pickaxe) score += 15;

      candidates.push({
        ...meta,
        relatedTickets: tickets,
        matchedTerm: term,
        matchedFile: file,
        score,
        method: block === pickaxe ? "pickaxe" : "grep",
      });
    }
  }

  return candidates;
}

function rankCandidates(rawCandidates, maxCandidates) {
  const byHash = new Map();

  for (const item of rawCandidates) {
    const prev = byHash.get(item.hash);
    if (!prev || item.score > prev.score) {
      byHash.set(item.hash, item);
    } else {
      prev.score += 2;
      prev.matchedTerms = [...new Set([...(prev.matchedTerms || [prev.matchedTerm]), item.matchedTerm])];
    }
  }

  return [...byHash.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);
}

function buildTraceResult(options) {
  const baseCommit = getMergeBase(options.target);
  const fixCommits = getFixCommitHashes(baseCommit);
  const changedFiles = getChangedFiles(baseCommit, options.files);
  const diffText = getUnifiedDiff(baseCommit, changedFiles);
  const searchTerms = extractSearchTerms(diffText, options.maxTerms);

  const rawCandidates = [];
  for (const file of changedFiles) {
    for (const term of searchTerms) {
      rawCandidates.push(
        ...searchIntroducingCommits(
          term,
          file,
          fixCommits,
          options.ticket,
        ),
      );
    }
  }

  const candidates = rankCandidates(rawCandidates, options.maxCandidates);
  const top = candidates[0] || null;

  return {
    ticket: options.ticket,
    target: options.target,
    baseCommit,
    branch: execGit("git rev-parse --abbrev-ref HEAD", { silent: true }),
    changedFiles,
    searchTerms,
    excludedFixCommits: [...fixCommits],
    candidates,
    topCandidate: top,
    traceable: Boolean(top && top.score > 0),
  };
}

function formatMarkdownSection(result) {
  const top = result.topCandidate;

  if (!result.changedFiles.length) {
    return `### 造成問題的單號

| 項目 | 值 |
|---|---|
| **追溯結果** | 無法追溯 |
| **說明** | 找不到可分析的變更檔案，請確認分支上已有 fix diff |
`;
  }

  if (!result.traceable || !top) {
    return `### 造成問題的單號

| 項目 | 值 |
|---|---|
| **追溯結果** | 無法追溯 |
| **說明** | 已分析 ${result.changedFiles.length} 個檔案與 ${result.searchTerms.length} 個搜尋詞，但未找到可信的引入 commit |
| **已排除** | 當前修復分支 commits（${result.excludedFixCommits.length} 筆）與單號 ${result.ticket} |
`;
  }

  const ticketCell =
    top.relatedTickets.length > 0
      ? top.relatedTickets
          .map(
            (t) => `[${t}](https://innotech.atlassian.net/browse/${t})`,
          )
          .join(", ")
      : "無法從 commit 判定";

  const explanation = [
    `以 \`${top.matchedTerm}\` 在 \`${top.matchedFile}\` 執行 git log -S 追溯`,
    `排除當前修復分支 ${result.excludedFixCommits.length} 筆 commit`,
    top.relatedTickets.length
      ? `關聯單號取自 commit message`
      : `commit message 未含 Jira 單號，請人工確認`,
  ].join("；");

  let section = `### 造成問題的單號

| 項目 | 值 |
|---|---|
| **引入問題的 Commit** | \`${top.shortHash}\` |
| **相關 Jira Ticket** | ${ticketCell} |
| **Commit Message** | ${top.message} |
| **引入日期** | ${top.authorDate} |
| **說明** | ${explanation} |
`;

  if (result.candidates.length > 1) {
    section += `
#### 其他候選（依可信度排序）

| Commit | 相關單號 | 日期 | 匹配 |
|---|---|---|---|
`;
    for (const c of result.candidates.slice(1)) {
      const tickets =
        c.relatedTickets.length > 0 ? c.relatedTickets.join(", ") : "—";
      section += `| \`${c.shortHash}\` | ${tickets} | ${c.authorDate} | \`${c.matchedTerm}\` @ \`${c.matchedFile}\` |\n`;
    }
  }

  return section;
}

function main() {
  const options = parseArgs(process.argv);

  if (!options.ticket) {
    console.error("❌ 缺少必要參數 --ticket=FE-1234");
    printHelp();
    process.exit(1);
  }

  const result = buildTraceResult(options);

  if (options.format === "json" || options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatMarkdownSection(result));
}

main();

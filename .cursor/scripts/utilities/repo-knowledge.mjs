#!/usr/bin/env node

/**
 * Repo Knowledge JSON CRUD 工具（含 schema 驗證）
 *
 * 預設檔案位置：adapt.json（專案根目錄）
 *
 * Commands:
 *   init
 *   read [--section=labels|coding-standard|git-flow|meta|sources|cache]
 *   update --section=... (--input='JSON' | --input-file='path/to.json')
 *   clear --section=...
 *   delete
 *
 * Notes:
 * - 本工具僅處理 JSON 的 CRUD 與 schema 驗證，不負責 GitLab / LLM 收集與分析（由 adapt.mjs 處理）。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getProjectRoot } from "./env-loader.mjs";

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

function getDefaultKnowledgeFile() {
  return join(projectRoot, "adapt.json");
}

function ensureDirForFile(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
    if (!isPlainObject(item)) {
      return { ok: false, error: `labels[${i}] 必須是 object` };
    }
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
  if (!Array.isArray(value)) {
    return { ok: false, error: "coding-standard 必須是 array" };
  }
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
  if (!("coding-standard" in obj)) {
    return { ok: false, error: "缺少 coding-standard" };
  }

  const labelsCheck = validateLabelsSection(obj.labels);
  if (!labelsCheck.ok) return labelsCheck;

  const csCheck = validateCodingStandardSection(obj["coding-standard"]);
  if (!csCheck.ok) return csCheck;

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

function getEmptyKnowledgeTemplate() {
  return {
    labels: [],
    "coding-standard": [],
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
    },
    sources: {},
    cache: {},
  };
}

function readKnowledge(filePath) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const obj = safeJsonParse(text, "repo knowledge JSON");
  const check = validateRepoKnowledgeObject(obj);
  if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
  return obj;
}

function writeKnowledge(filePath, obj) {
  const check = validateRepoKnowledgeObject(obj);
  if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
  ensureDirForFile(filePath);
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function showHelp() {
  const relDefault = "adapt.json";
  console.log(`
Repo Knowledge JSON CRUD

Usage:
  node .cursor/scripts/utilities/repo-knowledge.mjs <command> [options]

Commands:
  init
  read [--section=labels|coding-standard|git-flow|meta|sources|cache]
  update --section=<...> (--input='<JSON>' | --input-file='<path>')
  clear --section=<...>
  delete

Options:
  --file="<path>"          default: ${relDefault}

Examples:
  node .cursor/scripts/utilities/repo-knowledge.mjs init
  node .cursor/scripts/utilities/repo-knowledge.mjs read --section=labels
  node .cursor/scripts/utilities/repo-knowledge.mjs update --section=labels --input-file="./labels.json"
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command] = args._;

  if (!command || args.help) {
    showHelp();
    process.exit(command ? 0 : 1);
  }

  const filePath = args.file
    ? (args.file.startsWith("/") ? args.file : join(projectRoot, args.file))
    : getDefaultKnowledgeFile();

  if (command === "init") {
    const existing = readKnowledge(filePath);
    if (existing) {
      console.log(`✅ 已存在：${filePath}`);
      return;
    }
    const empty = getEmptyKnowledgeTemplate();
    writeKnowledge(filePath, empty);
    console.log(`✅ 已初始化：${filePath}`);
    return;
  }

  if (command === "delete") {
    if (!existsSync(filePath)) {
      console.log(`✅ 檔案不存在，略過：${filePath}`);
      return;
    }
    rmSync(filePath, { force: true });
    console.log(`✅ 已刪除：${filePath}`);
    return;
  }

  const knowledge = readKnowledge(filePath);
  if (!knowledge) {
    throw new Error(
      `找不到 repo knowledge JSON：${filePath}\n請先執行：repo-knowledge.mjs init 或 adapt.mjs`
    );
  }

  const KNOWN_SECTIONS = ["labels", "coding-standard", "git-flow", "meta", "sources", "cache"];

  if (command === "read") {
    const section = args.section;
    if (!section) {
      console.log(JSON.stringify(knowledge, null, 2));
      return;
    }
    if (!KNOWN_SECTIONS.includes(section)) {
      throw new Error(`未知 section：${section}`);
    }
    console.log(JSON.stringify(section in knowledge ? knowledge[section] : null, null, 2));
    return;
  }

  if (command === "clear") {
    const section = args.section;
    if (!section) throw new Error("clear 需要 --section");
    if (!KNOWN_SECTIONS.includes(section)) throw new Error(`未知 section：${section}`);

    if (section === "labels") knowledge.labels = [];
    else if (section === "coding-standard") knowledge["coding-standard"] = [];
    else if (section === "git-flow") delete knowledge["git-flow"];
    else if (section === "meta") knowledge.meta = {};
    else if (section === "sources") knowledge.sources = {};
    else if (section === "cache") knowledge.cache = {};
    else throw new Error(`不支援 clear section：${section}`);

    if (!Array.isArray(knowledge.labels)) knowledge.labels = [];
    if (!Array.isArray(knowledge["coding-standard"])) {
      knowledge["coding-standard"] = [];
    }

    if (!isPlainObject(knowledge.meta)) knowledge.meta = {};
    knowledge.meta.updatedAt = new Date().toISOString();

    writeKnowledge(filePath, knowledge);
    console.log(`✅ 已清除 section：${section}`);
    return;
  }

  if (command === "update") {
    const section = args.section;
    if (!section) throw new Error("update 需要 --section");
    if (!KNOWN_SECTIONS.includes(section)) throw new Error(`未知 section：${section}`);

    let inputText = null;
    if (typeof args.input === "string") inputText = args.input;
    if (typeof args["input-file"] === "string") {
      const p = args["input-file"];
      const resolved = p.startsWith("/") ? p : join(projectRoot, p);
      inputText = readFileSync(resolved, "utf-8").replace(/^\uFEFF/, "");
    }
    if (!inputText) {
      throw new Error("update 需要 --input 或 --input-file");
    }

    const incoming = safeJsonParse(inputText, "update input");

    if (section === "labels") {
      const check = validateLabelsSection(incoming);
      if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
      knowledge.labels = incoming;
    } else if (section === "coding-standard") {
      const check = validateCodingStandardSection(incoming);
      if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
      knowledge["coding-standard"] = incoming;
    } else if (section === "git-flow") {
      const check = validateGitFlowSection(incoming);
      if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
      knowledge["git-flow"] = incoming;
    } else if (section === "meta" || section === "sources" || section === "cache") {
      if (!isPlainObject(incoming)) {
        throw new Error(`${section} 必須是 object`);
      }
      knowledge[section] = incoming;
    } else {
      throw new Error(`不支援 update section：${section}`);
    }

    if (!isPlainObject(knowledge.meta)) knowledge.meta = {};
    knowledge.meta.updatedAt = new Date().toISOString();
    writeKnowledge(filePath, knowledge);
    console.log(`✅ 已更新 section：${section}`);
    return;
  }

  throw new Error(`未知 command：${command}`);
}

main().catch((e) => {
  console.error(`\n❌ repo-knowledge 失敗：${e.message}\n`);
  process.exit(1);
});


#!/usr/bin/env node

/**
 * === 檔案用途區塊 ===
 * @module script-runtime
 * @purpose 管理 .cursor/scripts/utilities/repo-knowledge.mjs 的註解補全與用途說明
 * @external https://innotech.atlassian.net/browse/FE-8016
 * @external https://innotech.atlassian.net/browse/FE-8007
 */

/**
 * === 宣告內容用途說明與單號關聯 ===
 * @description 本區塊以下宣告需標示用途與單號關聯
 * @purpose 統一定義宣告級註解格式與單號追溯規則
 */

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

/** 檔案用途區塊
 * @module repo-knowledge
 * @purpose CLI 工具：針對 adapt.json 的 repo knowledge 內容進行讀寫、清除與 schema 驗證。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getProjectRoot } from "./env-loader.mjs";

/** 宣告內容用途說明與單號關聯
 * @description 取得專案根目錄路徑，供後續組裝 adapt.json 預設檔案路徑。
 * @purpose 避免在不同執行目錄下造成相對路徑不一致。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
const projectRoot = getProjectRoot();

/** 宣告內容用途說明與單號關聯
 * @description 解析 CLI 參數，支援 `--key=value` 與旗標形式 `--help`，並保留非 `--` 的參數於 `_`。
 * @purpose 讓主流程能以 args._ / args.section / args.input 等方式取得輸入。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/** 宣告內容用途說明與單號關聯
 * @description 組合 adapt.json 的預設檔案路徑。
 * @purpose 將預設資料落在專案根目錄。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
function getDefaultKnowledgeFile() {
  return join(projectRoot, "adapt.json");
}

/** 宣告內容用途說明與單號關聯
 * @description 若目標檔案所在目錄不存在則建立。
 * @purpose 寫入時避免因缺少資料夾而失敗。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
function ensureDirForFile(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** 宣告內容用途說明與單號關聯
 * @description 進行 JSON.parse 並在失敗時包裝成更易讀的錯誤訊息。
 * @purpose 讓 CLI 在輸入無效 JSON 時能回報具體錯誤上下文。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
function safeJsonParse(text, hint = "JSON") {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${hint} 解析失敗：${e.message}`);
  }
}

/** 宣告內容用途說明與單號關聯
 * @description 判斷值是否為純物件（排除 null / array）。
 * @purpose 作為 schema 驗證的型別守門。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 宣告內容用途說明與單號關聯
 * @description 驗證 labels 區塊結構：包含 name / scenario，以及可選的 applicable（布林或 {ok, reason}）。
 * @purpose 確保 labels 內容符合後續使用時的結構預期。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/** 宣告內容用途說明與單號關聯
 * @description 驗證 git-flow 區塊結構：flowType / defaultBranch / summary 為必要字串。
 * @purpose 確保 git-flow 描述可供後續流程依賴。
 * @external https://innotech.atlassian.net/browse/FE-8016
 */
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

/** 宣告內容用途說明與單號關聯
 * @description 驗證 coding-standard 區塊結構：array 內每項需包含 rule / example 非空字串。
 * @purpose 確保 coding-standard 內容符合 schema 預期。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/** 宣告內容用途說明與單號關聯
 * @description 驗證整份 repo knowledge 物件：必須包含 labels 與 coding-standard，且其餘區塊採可選並以型別限制。
 * @purpose 在讀寫檔案時確保資料一致性與 schema 正確性。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/** 宣告內容用途說明與單號關聯
 * @description 建立 repo knowledge 的初始化模板（包含 meta.schemaVersion 與 generatedAt）。
 * @purpose 提供 `init` 指令可直接寫入的預設結構。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/** 宣告內容用途說明與單號關聯
 * @description 讀取指定檔案並進行 schema 驗證，成功回傳物件，檔案不存在回傳 null。
 * @purpose 讓主流程能在 init/update/read/clear/delete 前先判斷狀態。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
function readKnowledge(filePath) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const obj = safeJsonParse(text, "repo knowledge JSON");
  const check = validateRepoKnowledgeObject(obj);
  if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
  return obj;
}

/** 宣告內容用途說明與單號關聯
 * @description 將已驗證的 repo knowledge 物件寫回檔案（包含確保目錄存在）。
 * @purpose 對外提供一致且 schema-safe 的持久化能力。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
function writeKnowledge(filePath, obj) {
  const check = validateRepoKnowledgeObject(obj);
  if (!check.ok) throw new Error(`schema 驗證失敗：${check.error}`);
  ensureDirForFile(filePath);
  writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

/** 宣告內容用途說明與單號關聯
 * @description 印出 CLI 使用說明與範例。
 * @purpose 讓使用者能快速理解 commands/options。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/** 宣告內容用途說明與單號關聯
 * @description CLI 入口：根據 command 執行 init/read/update/clear/delete，並在必要時讀取與寫回 adapt.json。
 * @purpose 將參數解析、schema 驗證與檔案操作串接成可用的命令流程。
 * @external https://innotech.atlassian.net/browse/FE-8007
 */
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

/**
 * === llm 分析紀錄區 ===
 * @llm-review-submitted-at 2026-06-13T19:34:29.422Z
 * @llm-review-model gpt-5.4-nano
 * @llm-review-note 修正宣告區塊中的 @external 標籤，使其符合要求的完整 Jira browse URL 格式（https://innotech.atlassian.net/browse/<TICKET>），並保留原有 runtime 邏輯不變。
 */

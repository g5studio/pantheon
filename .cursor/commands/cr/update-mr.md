---
description: 更新現有 MR（不產生實體檔案、merge 內容避免重複、預設會審核但僅限 new commit）
---

<!-- cspell:disable -->

當用戶需要 **修改現有 MR**（更新 description / 開發報告 / 追加資訊）時，**必須**使用此流程：

## Agent-first 外部腳本讀法（CRITICAL — [FE-8389](https://innotech.atlassian.net/browse/FE-8389)）

**腳本命中（掛載專案）**：先查 host `package.json`；有 script 用 `pnpm run <script> -- <args>`；無 script 用 `node .pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs <path> <args>`。

**禁止舊讀法**：
- ❌ 用 `create-mr` 更新既有 MR（更新一律走 `update-mr`）
- ❌ 把 stderr 進度 log 當結果
- ❌ 讀 Jira 時使用 `--include-raw` / `raw.fields.*`
- ❌ 覆蓋 MR description 而非 merge 追加

| 步驟 | 腳本 | 建議參數 | Agent 解析重點 |
|---|---|---|---|
| 讀 Jira（補報告） | `read-jira-ticket` | `--format=agent` | `summary`, `issueType`, `description`, `meta` |
| Bug 追溯（如適用） | `trace-bug-root-cause` | `--format=agent` | `markdownSection`, `topCandidate` |
| 更新 MR | `update-mr` | `--development-report=...` | stdout JSON：`mr.iid`, `mr.webUrl`, `aiReview` |

## 核心原則

- **create-mr 只用於建立新 MR**；任何 MR 更新行為一律走 `update-mr.mjs`
- 開發報告一律透過 `--development-report` 傳入，**不得產出任何實體檔案**
- 更新 description 以 merge 的概念進行（marker-based），避免報告重複
- **用戶可要求不審核**（`--no-review`）
- **若缺少 `COMPASS_API_TOKEN`，則會自動跳過 AI review**（其餘 MR 更新流程照常）
- **未特別說明時預設要審核**，但前提是「相對於上次已送審狀態」有 new commit；否則不送

## 使用方式

```bash
pnpm run update-mr -- \
  --development-report="$(cat <<'EOF'
## 📋 關聯單資訊

| 項目 | 值 |
|---|---|
| **單號** | [FE-7910](https://innotech.atlassian.net/browse/FE-7910) |
| **標題** | ... |
| **類型** | ... |

---

## 📝 變更摘要

...

### 變更內容

| 檔案 | 狀態 | 說明 |
|---|---|---|
| `path/to/file.ts` | 更新 | ... |

---

## ⚠️ 風險評估

| 檔案 | 風險等級 | 評估說明 |
|---|---|---|
| `path/to/file.ts` | 中度 | ... |
EOF
)"
```

**Agent 解析**：只讀 stdout 的 compact JSON（`ok`, `mr`, `aiReview`, `message`）；進度在 stderr。

### 可選參數

- `--no-review`：明確跳過 AI review（即使有 new commit 也不送）

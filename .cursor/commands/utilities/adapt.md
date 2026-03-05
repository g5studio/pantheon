---
description: 生成/更新 repo 知識庫 JSON（labels / coding-standard / git-flow）並提供 CRUD 工具（含 schema 驗證與 LLM 快取）
---

## adapt - repo 知識庫落地化

此指令用於將「當前 repo」可重用的知識整理成一份結構化 JSON（寫入專案根目錄），並支援 CRUD 操作與 LLM 分析結果快取，讓後續不同指令可以直接讀取整理後的內容，減少 token 使用並提升推論穩定性。

**知識庫區塊**：`labels`（GitLab 標籤情境）、`coding-standard`（編碼規範）、`git-flow`（Git 分支流程推導）。

---

## 1) adapt 主流程（收集 + 分析 + 寫回）

當用戶輸入 `adapt` 時，AI 執行：

```bash
node .cursor/scripts/utilities/adapt.mjs
```

常用參數：

```bash
# 指定輸出 JSON 位置（預設：adapt.json）
node .cursor/scripts/utilities/adapt.mjs --file="adapt.json"

# 限制抽樣 MR 數量（預設：50）
node .cursor/scripts/utilities/adapt.mjs --max-mrs=50

# 指定 GitLab 主機（預設：從 remote.origin.url 解析）
node .cursor/scripts/utilities/adapt.mjs --gitlab-host="https://gitlab.service-hub.tech"

# 指定 LLM provider/model（若不指定，model 預設為 gpt-5.2）
node .cursor/scripts/utilities/adapt.mjs --llm-provider="openai" --llm-model="gpt-5.2"

# 僅收集資料，不呼叫 LLM（仍會把 sources/meta 寫回 JSON）
node .cursor/scripts/utilities/adapt.mjs --no-llm
```

### 依賴的環境變數（擇一即可）

- GitLab 資料收集（至少一種）
  - `GITLAB_TOKEN`（推薦）
  - 或已完成 `glab auth login`（腳本會嘗試使用 glab）

- LLM 分析（至少一種；`--no-llm` 可跳過）
  - `OPENAI_API_KEY`（openai provider）
  - `ADAPT_LLM_MODEL`（可選，未指定時預設使用 `gpt-5.2`）

> 若未設置 `OPENAI_API_KEY`，`adapt` 會**自動降級為 `--no-llm` 模式**（只更新 `sources/meta/cache`，不會報錯）。
>
> **git-flow 推導**：無論是否呼叫 LLM，`adapt` 都會從本地 git 收集分支與 merge 模式（`git branch -a`、`git log --grep="Merge branch"` 等），並寫入 `git-flow` 區塊。有 LLM 時由 LLM 分析推導；無 LLM 時以規則推導（`inferGitFlowFromData`）。
>
> `labels` 會以「專案所有 labels」為輸出範圍；每個 label 會包含：
> - `applicable.ok`: `boolean`，標記該 label 是否適合本 repo（不相關者應為 `false`）
> - `applicable.reason`: `string`，說明判定理由（1-2 句）
> - `scenario`: 以多數貼過該 label 的 MR changes 推測通用使用情境（忽略少數相悖 outliers）
> - 對於近三個月內未觀察到使用案例的 labels，`scenario` 會依 label 名稱/描述與 repo 結構做保守推測。

---

## 2) JSON CRUD 工具（含 schema 驗證）

此工具針對同一份 repo 知識庫 JSON 做 CRUD（支援 section 級別操作）。

```bash
node .cursor/scripts/utilities/repo-knowledge.mjs --help
```

常用範例：

```bash
# Create（初始化/建檔）
node .cursor/scripts/utilities/repo-knowledge.mjs init

# Read（整份）
node .cursor/scripts/utilities/repo-knowledge.mjs read

# Read（指定 section）
node .cursor/scripts/utilities/repo-knowledge.mjs read --section=labels
node .cursor/scripts/utilities/repo-knowledge.mjs read --section=git-flow

# Update（指定 section，從 JSON 檔案讀入）
node .cursor/scripts/utilities/repo-knowledge.mjs update --section=labels --input-file="./labels.json"

# Clear（清除指定 section）
node .cursor/scripts/utilities/repo-knowledge.mjs clear --section=coding-standard
node .cursor/scripts/utilities/repo-knowledge.mjs clear --section=git-flow

# Delete（刪除整份 JSON）
node .cursor/scripts/utilities/repo-knowledge.mjs delete
```

---

## 3) git-flow 區塊 schema

`git-flow` 由 LLM 或 fallback 規則推導，用於記錄專案的 Git 分支流程：

| 欄位 | 類型 | 說明 |
|------|------|------|
| `flowType` | string | 整體 flow 類型（如 Git Flow 變體、Trunk-based） |
| `defaultBranch` | string | 預設分支（origin/HEAD 指向） |
| `summary` | string | 1–3 句流程摘要 |
| `branches` | array | 長期分支列表，每項含 `name`、`role`、`description` |
| `mergeFlow` | string | 合併流向（如 feat/fix → release → dev） |
| `branchNaming` | object | `format`、`examples` |
| `mrTargets` | array | 常見 MR 目標分支 |

**收集來源**：`git branch -a`、`git symbolic-ref origin/HEAD`、`git log --grep="Merge branch"`。


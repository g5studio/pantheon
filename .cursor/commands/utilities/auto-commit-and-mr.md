---
description: 自動執行 commit 和建立 MR 的完整流程
---

<!-- cSpell:disable -->

# Auto Commit And MR

此文件是 Pantheon commit / push / MR 指令的共享入口。目標是**用最少說明保留原有行為**；命令專屬差異交由各自 command doc 補充。

## 掛載專案命中規則

**CRITICAL**：先檢查當前專案 `package.json` 是否有對應 script。

- 有 script：使用 `pnpm run <script> -- <args>`
- 無 script：使用 `node .pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs <script-path> <args>`
- 若當前就在 Pantheon repo 內：fallback 使用 `node .cursor/scripts/utilities/run-pantheon-script.mjs <script-path> <args>`

**禁止**硬編碼 Pantheon 腳本路徑（例如 `node .cursor/scripts/...`）來取代可用的 package script。

對於 commit / MR workflow，以上規則已經是**完整的路徑判斷依據**。

- 對外描述腳本時，保持原本的**邏輯腳本路徑**表示法，例如 `cr/create-mr.mjs` 或 `.cursor/scripts/cr/create-mr.mjs`
- `.pantheon/.cursor/scripts/...` 只用於 mounted repo 內的實際執行 / 存在性檢查，不作為新的腳本標識方式
- 不需要再額外讀 `pantheon-path-guideline.mdc`
- 只使用當前 target repo 的 `package.json` 與 mounted `.pantheon`
- 只有在「當前 repo `package.json` 無 script，且 mounted runner 路徑也無法確認」時，才可再查其他 path guideline

## 指令路由

### `cr single-ticket`

- 使用當前分支單號作為唯一主單號
- 不使用 `--related-tickets`
- 略過關聯單號詢問
- 預設 draft
- 預設送 AI review
- 若偵測到其他 ticket，提示改用 `cr multiple-ticket`

### `cr multiple-ticket`

- 必須有多於一個 Jira ticket
- 支援 `--related-tickets`
- 支援「主單 + 所有子任務」意圖
- 預設 draft
- 預設送 AI review
- 若只有一個 ticket，停止並提示補充關聯單號、抓子任務、或改用 `cr single-ticket`

### `commit-and-push`

- 只做 commit + push
- 不建立 MR
- 不處理 AI review

### 其他自然語言請求

若用戶不是直接輸入 `cr single-ticket` / `cr multiple-ticket` / `commit-and-push`，而是使用自然語言，例如：

- `幫我 commit`
- `提交代碼`
- `commit 並建立 MR`

則仍應沿用原本的共享流程：

- 先依上下文判斷用戶要的是 commit-only 還是 commit + MR
- 若流程包含建立 MR，預設仍視為**會送 AI review**
- 只有在用戶**明確表達不送審**時，才改為 `--no-review`
- 若語意對應單一 ticket，走 `cr single-ticket`
- 若語意對應多 ticket / 關聯單 / 子任務意圖，走 `cr multiple-ticket`
- 若是一般 `commit + MR` 請求且尚未明確落到 `cr single-ticket`，建立 MR 前仍要保留「是否有其他關聯單號」的詢問與確認

## 共用執行流程

當用戶要求幫忙 commit、push、或建立 MR 時，依照以下順序執行：

1. 檢查 Git 狀態
2. 取得目前分支；若分支是 `main` / `master` / `develop`，必須先警告用戶風險，但可在用戶知情下繼續
3. 從上下文推斷 commit type / ticket / message
4. 驗證 commit message 是否符合規範
5. 檢查 Cursor rules；若需要改碼才能通過，**停止並先詢問**
6. 若為 Bug，先追溯造成問題的 commit / ticket
7. 執行 `agent-commit`
8. 若需要建立 MR，再補齊 `create-mr` / `update-mr` 必要參數
9. 成功後在 chat 回報 commit / MR 結果

## Commit 推斷規則

優先順序：

1. 用戶明確提供的資訊
2. 從分支名稱與近期上下文推斷
3. 無法推斷時再詢問

常見 type 對照：

- 新功能：`feat`
- 問題修復：`fix`
- 既有功能更新：`update`
- 結構重整：`refactor`
- 其他：`chore`

驗證規則：

- type 必須符合 commitlint
- ticket 格式必須是 `[A-Z0-9]+-[0-9]+`
- message 必須小寫，最大 64 字元

## 參數推斷原則

以下規則適用於 `cr single-ticket` 與 `cr multiple-ticket`：

- `--reviewer`：只有用戶**明確指定**時才傳
- `--target`：只有用戶**明確指定**時才傳；否則讓 MR 流程按 fix version / 預設值推斷
- `--no-draft`：只有用戶**明確要求**非 draft 時才傳
- `--no-review`：只有用戶**明確要求**不送審時才傳
- `--no-notify`：只有用戶**明確要求**關閉通知時才傳

自動偵測仍需保留，且支援中英文描述：

- 其他 Jira 單號
- reviewer
- target branch
- 非 draft 意圖
- 不送審意圖
- `multiple-ticket` 的子任務意圖

若從自然語言偵測到 reviewer / target branch / 非 draft / 不送審 / 不通知等候選意圖：

- 先在 chat 向用戶確認，再決定是否帶入對應參數
- 不可因為偵測到了候選值，就直接視為用戶已明確指定
- 若存在多個候選值或語意歧義，必須先詢問，不能自行猜測

對於 `cr single-ticket`，如果偵測到其他 ticket，仍要詢問，但最後要提示改用 `cr multiple-ticket`。

若流程會建立 MR，且不是明確走 `cr single-ticket`：

- 建立 MR 前要先詢問是否除了當前分支單號外還有同步修復其他單號
- 若文字描述已偵測到其他 ticket，優先拿這些候選值向用戶確認是否作為 `--related-tickets`
- 若用戶提供或確認了關聯單號，傳入前必須先驗證其存在性；若驗證失敗，必須停止並請用戶重新確認
- 若關聯單號與當前分支 / 主單語意不一致且需要用戶決策，必須停止並先詢問

## MR 路由判斷

在真正執行任何 MR 腳本前，必須先判定這次是：

- **建立新 MR**：走 `create-mr`
- **更新既有 MR**（例如補開發報告、更新 description、補 labels / reviewer）：走 `update-mr`

**不得**先執行 `create-mr.mjs`，再把「是否已有 MR」的判斷留給腳本 runtime 才處理。

若上下文明確是更新既有 MR，必須直接依 [update-mr.md](../cr/update-mr.md) 流程處理。

## Target Branch

`create-mr` 會自動依 Jira fix version 推斷 target branch。

- Hotfix 版本 `major.minor.patch` 且 `patch != 0`：推斷為 `release/major.minor`
- 其他情況：預設 `main`
- AI **不要**主動傳 `--target`，除非用戶明確指定

## 建立 MR 前必備資訊

建立 MR 前至少要補齊以下資訊：

- `--development-report`
- `--labels`
- `--agent-version`（若可取得）
- `--reviewer`（僅用戶明確指定時）
- `--related-tickets`（如有）

### Development Report

`create-mr` 前必須生成開發報告，最少包含：

- `## 📋 關聯單資訊`
- `## 📝 變更摘要`
- `### 變更內容`
- `## ⚠️ 風險評估`

如果是 `Bug` / `Request`，補上對應專屬區塊；`Bug` 也必須包含「造成問題的單號」資訊。

**CRITICAL**：傳入 `--development-report` 時必須確保 Markdown 不跑版，避免字面 `\n`。

### Labels

- 以 `adapt.json` 等 repo knowledge 的可用 label 清單為準
- 根據 Jira 類型、目標分支、與實際改動範圍判定
- 分析**全部** commits（base 到 HEAD）的 net effect，非僅最新 commit
- 4.0UI / 3.0UI / FE Board / Static File / Vendor Customization 依 [commit-and-mr-guidelines.mdc](mdc:.cursor/rules/cr/commit-and-mr-guidelines.mdc) 判定
- `FE Board` 只看**當前分支主單號**；`--related-tickets` 中的 `FE-...` 不會單獨觸發 `FE Board`

### Agent Version

版本檔案查找順序：

1. `.pantheon/version.json`
2. `version.json`
3. `.cursor/version.json`
4. 其他檔名包含 `pantheon` 的 `version.json`

找到後把 JSON 內容透過 `--agent-version` 傳入。

## MR 執行邊界

在以下資訊都已補齊前，**不可**實際執行 `create-mr.mjs` / `update-mr.mjs`：

- 已完成 create / update 路由判斷
- `--development-report`
- `--labels`
- `--agent-version`（若可取得）
- `--reviewer` / `--related-tickets`（若適用）

若用戶明確指定 reviewer，但腳本回報找不到該 reviewer：

- 必須停止並在 chat 詢問用戶改用預設 reviewer 或重新輸入 reviewer
- 不可靜默移除 reviewer、不可假設改用其他人、也不可忽略錯誤直接繼續

`create-mr.mjs` 不是純推導器；一旦執行，就可能進入 rebase / push / MR 檢查流程。

因此：

- 若目前只是推導 title / description / labels / target branch，應只做本地分析，不可執行腳本
- 若任務是 benchmark / review / payload 檢查 / 行為分析，應停在本地 payload 推導，不可執行腳本
- 只有在真的準備好接受 `create-mr.mjs` 的正常 side effects 時，才可執行
- 若 script 路徑不可用或腳本執行方式無法成立，才退回提供手動 MR 建立連結；不要在 script 可用時直接跳過既有流程

## 停止條件

以下情況不可直接繼續：

- 需要修改代碼才能通過檢查
- Jira / GitLab 必備資訊讀取失敗
- reviewer / target branch / labels 無法正確判定且需要用戶決定
- rebase 或 push 失敗

此時必須遵守 [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc)。

## 結果回報

MR 建立成功後，**必須沿用既有的 chat 呈現方式**：

- 使用用戶語言
- 依 [mr-execution-result-report.mdc](mdc:.cursor/rules/cr/mr-execution-result-report.mdc) 的格式與 emoji 區塊回報
- 不要用更精簡、無 emoji 的替代格式覆蓋它

最少包含：

- commit 資訊
- MR 連結 / ID / 標題 / 狀態
- reviewer
- labels
- 關聯 Jira
- AI review 狀態
- 變更摘要

## 命令模板

### Commit

```bash
pnpm run agent-commit -- --type={type} --ticket={ticket} --message="{message}" --auto-push
```

### Create MR

```bash
pnpm run create-mr -- --development-report="{markdown}" --labels="{labels}" [--agent-version='{json}']
```

### Update MR

```bash
pnpm run update-mr -- --development-report="{markdown}"
```

### Manual MR Fallback

若無法使用既有 MR 腳本流程，可改為提供手動建立 MR 連結：

```text
https://{gitlab-host}/{project-path}/-/merge_requests/new?merge_request[source_branch]={branch-name}&merge_request[target_branch]=main&merge_request[work_in_progress]=true
```

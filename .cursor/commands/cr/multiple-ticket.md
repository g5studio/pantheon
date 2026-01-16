---
description: 快速執行 commit 並建立 MR 的完整流程，必須提供多於一個 Jira ticket（預設送審，可用 --no-review 跳過）
---

請參考 [auto-commit-and-mr.md](../auto-commit-and-mr.md) 中的 `cr multiple-ticket` 指令說明。

## 核心要求

**CRITICAL**: `cr multiple-ticket` 指令**必須**提供多於一個 Jira ticket。如果只有一個 ticket，請使用 `cr single-ticket` 指令。

## 執行流程

當用戶輸入 `cr multiple-ticket` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. **驗證多 ticket 要求**（見下方說明）
3. 從上下文推斷 commit 信息（type, ticket, message）
4. 執行 commit 並推送到遠端
5. 自動建立 MR（包含 FE Board label、reviewer、draft 狀態、delete source branch）
6. **預設提交 AI review**（用戶可用 `--no-review` 明確跳過；若缺少 `COMPASS_API_TOKEN` 則會自動跳過 AI review；若為更新既有 MR，會由 `update-mr.mjs` 決定是否送審）
7. **自動檢查 Cursor rules**：在執行 commit 之前，AI 會檢查代碼是否符合 Cursor rules
8. **Bug 類型強制追溯來源**：如果 Jira ticket 類型為 Bug，AI 必須在生成開發報告前執行 `git log` 追溯問題來源，並在報告中包含「造成問題的單號」區塊。詳細流程請參考 [auto-commit-and-mr.md](../utilities/auto-commit-and-mr.md) 中的「步驟 4.6. Bug 類型強制追溯來源」章節。
9. **生成開發報告（CRITICAL）**：在建立 MR 前，**必須**根據 Jira ticket 資訊和變更內容生成開發報告，並透過 `--development-report` 傳遞給 `create-mr.mjs`。**CRITICAL**：Agent 必須確保傳入的是「不跑版」的 Markdown（避免出現字面 `\n`）。
10. **讀取 Agent 版本（CRITICAL）**：在建立 MR 前，**必須**讀取 `version.json`（優先順序：`.pantheon/version.json` → `version.json` → `.cursor/version.json`）並透過 `--agent-version` 參數傳遞給 `create-mr.mjs`。
11. **MR description 格式回歸檢查（CRITICAL）**：在建立/更新 MR 前，腳本會驗證 MR description 是否包含規範要求的開發報告格式（關聯單資訊/變更摘要/變更內容表格/風險評估表格；若可辨識為 Bug，需包含影響範圍與根本原因）。不符合將中止流程並提示補齊方式（`create-mr.mjs` 僅用於建立；更新請使用 `update-mr.mjs`）。

## 多 Ticket 驗證流程

### 情況 1: 用戶明確提供多個 ticket
```
用戶輸入: "cr multiple-ticket 這個修改同時修復了 IN-1235 和 IN-1236"

→ 驗證通過，繼續執行流程
```

### 情況 2: 用戶語意暗示「主單與所有子任務」
當偵測到以下關鍵字時，自動與用戶確認：
- **中文**：「所有子任務」、「所有子項目」、「包含子任務」、「主單和子任務」、「全部子單」、「關聯的子任務」
- **英文**：「all subtasks」、「with subtasks」、「including subtasks」、「parent and children」、「all child issues」

```
用戶輸入: "cr multiple-ticket 這個改動包含主單和所有子任務"

AI 詢問: 
"偵測到您的意圖可能是「以當前主單與所有關聯子任務進行」。
當前分支單號: FE-7893

請確認：
1. 是，自動獲取 FE-7893 的所有子任務並作為關聯單號
2. 否，我會手動提供關聯單號"

用戶選擇: 1

AI 執行:
1. 透過 Jira API 讀取 FE-7893 的子任務
2. 獲取子任務列表（例如：FE-7894, FE-7895, FE-7896）
3. 自動設置 --related-tickets="FE-7894,FE-7895,FE-7896"
4. 繼續執行流程
```

### 情況 3: 用戶只提供一個 ticket 且無子任務意圖
```
用戶輸入: "cr multiple-ticket"（只有當前分支單號）

AI 提示:
"⚠️ `cr multiple-ticket` 指令必須提供多於一個 Jira ticket。

請選擇：
1. 提供關聯單號（手動輸入）
2. 自動獲取當前分支單號的所有子任務
3. 改用 `cr single-ticket` 指令（僅使用當前分支單號）"

→ 根據用戶選擇繼續執行
```

## 獲取子任務的方法

當用戶確認要獲取子任務時，AI 應執行以下步驟：

1. **讀取 Jira ticket 信息**：
   ```bash
   node .cursor/scripts/jira/read-jira-ticket.mjs "<ticket-id>"
   ```

2. **從回傳的 JSON 中提取子任務**：
   - 子任務位於 `raw.fields.subtasks` 陣列中
   - 每個子任務有 `key` 欄位（例如：`FE-7894`）

3. **驗證子任務存在**：
   - 如果沒有子任務，告知用戶並提供其他選項
   - 如果有子任務，列出所有子任務供用戶確認

4. **確認並繼續**：
   ```
   AI: 找到以下子任務：
   - FE-7894: 子任務標題 1
   - FE-7895: 子任務標題 2
   - FE-7896: 子任務標題 3
   
   是否使用這些子任務作為關聯單號？
   1. 是，全部使用
   2. 否，我要選擇部分
   3. 取消，改用其他方式
   ```

## 參數支持

- `cr multiple-ticket --reviewer="@username"`：指定 MR reviewer（**僅在用戶明確指定時使用**）
  - **Reviewer 優先順序**：
    1. 命令行參數（`--reviewer=`）：最高優先級，用戶明確指定
    2. 環境變數（`.env.local` 中的 `MR_REVIEWER`）：用戶偏好設置
    3. 預設值（`@william.chiang`）：如果未設置環境變數則使用此值
  - **重要**：AI 自動執行 `cr multiple-ticket` 命令時，**不應傳遞 `--reviewer` 參數**，讓腳本自動從環境變數讀取或使用預設值
- `cr multiple-ticket --target=branch-name`：指定目標分支（預設: "main"）
- `cr multiple-ticket --no-draft`：不使用 draft 狀態（預設為 draft）
- `cr multiple-ticket --no-review`：明確跳過 AI review（不送審）
- `cr multiple-ticket --related-tickets="IN-1235,IN-1236"`：指定關聯單號（多個單號用逗號分隔）
- `cr multiple-ticket --no-notify`：停用所有系統通知功能（預設為開啟）

## 參數使用範例

- `cr multiple-ticket --related-tickets="IN-1235,IN-1236"`：明確指定關聯單號
- `cr multiple-ticket 這個改動包含所有子任務`：自動獲取子任務
- `cr multiple-ticket --reviewer="@john.doe" --related-tickets="IN-1235,IN-1236"`：指定 reviewer 和關聯單號
- `cr multiple-ticket --target=develop --no-draft`：目標分支為 develop，且不使用 draft 狀態

## 重要：保護現有 Reviewer 規則

- 如果 MR 已經存在且已有 reviewer，系統會自動檢查：
  - **如果用戶未明確指定 `--reviewer` 參數**（即使用預設值），系統會**保留現有的 reviewer**，不會更新
  - **如果用戶明確指定了 `--reviewer` 參數**（例如：`cr multiple-ticket --reviewer="@john.doe"`），系統會**更新 reviewer** 為指定的用戶
- 此規則適用於所有 `cr` 系列指令（`cr single-ticket`、`cr multiple-ticket`）

## 智能偵測功能（支援跨語系）

系統會自動偵測文字描述中的參數相關內容，並詢問是否要設置對應參數。

1. **子任務意圖偵測**：如果提到了「所有子任務」、「子項目」等關鍵字，系統會自動詢問是否要獲取子任務
   - 中文範例：`cr multiple-ticket 這個改動包含主單和所有子任務` → 自動詢問是否獲取子任務
   - 英文範例：`cr multiple-ticket this change includes all subtasks` → 自動詢問是否獲取子任務

2. **關聯單號偵測**：如果提到了單號（例如：`IN-1234`、`FE-5678` 等），系統會自動偵測並詢問是否要添加到 `--related-tickets` 參數
   - 中文範例：`cr multiple-ticket 這個修改同時修復了 IN-1235 和 IN-1236 的問題` → 系統會自動偵測到 IN-1235 和 IN-1236
   - 英文範例：`cr multiple-ticket this fix also resolves IN-1235 and IN-1236` → 系統會自動偵測到 IN-1235 和 IN-1236

3. **Reviewer 偵測**：如果提到了 reviewer 用戶名（例如：`@john.doe`），系統會自動偵測並詢問是否要設置為 `--reviewer` 參數

4. **目標分支偵測**：如果提到了目標分支名稱（例如：`develop`、`main` 等），系統會自動偵測並詢問是否要設置為 `--target` 參數

5. **Draft 狀態偵測**：如果提到了非草稿狀態的意圖，系統會自動偵測並詢問是否要設置 `--no-draft` 參數

6. **通知設定偵測**：如果提到了不要通知的意圖，系統會自動偵測並設置 `--no-notify` 參數

## 注意事項

- `cr multiple-ticket` 指令**必須**有多於一個 Jira ticket（當前分支單號 + 至少一個關聯單號）
- 如果只需要使用單一 ticket，請使用 `cr single-ticket` 指令
- `cr multiple-ticket` 指令預設會送審；如需不送審，請使用 `--no-review`

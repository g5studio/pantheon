---
description: 快速執行 commit 並建立 MR，略過關聯單號詢問（強制包含送審）
---

請參考 [auto-commit-and-mr.md](../auto-commit-and-mr.md) 中的 `cr single-ticket` 指令說明。

當用戶輸入 `cr single-ticket` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. 從上下文推斷 commit 信息（type, ticket, message）
3. 執行 commit 並推送到遠端
4. **略過關聯單號詢問環節**，直接使用當前分支單號
5. 自動建立 MR（包含 FE Board label、reviewer、draft 狀態、delete source branch）
6. **自動提交 AI review**（`cr single-ticket` 指令強制包含送審功能，無法略過）
7. **自動檢查 Cursor rules**：在執行 commit 之前，AI 會檢查代碼是否符合 Cursor rules。如果檢測到違規，會自動顯示系統通知（macOS/Windows）並自動切換到 Cursor，停止 commit 流程
8. **Bug 類型強制追溯來源**：如果 Jira ticket 類型為 Bug，AI 必須在生成開發報告前執行 `git log` 追溯問題來源，並在報告中包含「造成問題的單號」區塊。詳細流程請參考 [auto-commit-and-mr.md](../utilities/auto-commit-and-mr.md) 中的「步驟 4.6. Bug 類型強制追溯來源」章節。

**重要**：必須遵守 [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc) 規則：當檢測到需要修改代碼的問題時，**必須立即停止並詢問用戶**，不能自動修復。**先詢問再修改 > 完成任務**。

**參數支持：**
- `cr single-ticket --reviewer="@username"`：指定 MR reviewer（**僅在用戶明確指定時使用**）
  - **Reviewer 優先順序**：
    1. 命令行參數（`--reviewer=`）：最高優先級，用戶明確指定
    2. 環境變數（`.env.local` 中的 `MR_REVIEWER`）：用戶偏好設置
    3. 預設值（`@william.chiang`）：如果未設置環境變數則使用此值
  - **重要**：AI 自動執行 `cr single-ticket` 命令時的處理方式：
    - **如果用戶明確指定了 reviewer**（例如：在指令中提供了 `--reviewer` 參數，或在文字描述中提到了 reviewer 並確認使用），**必須傳遞 `--reviewer` 參數**
    - **如果用戶未明確指定 reviewer**（未提供參數且未在文字描述中提及），**不應傳遞 `--reviewer` 參數**，讓腳本自動從環境變數讀取或使用預設值
- `cr single-ticket --target=branch-name`：指定目標分支（預設: "main"）
  - **重要**：關於 Hotfix target branch 自動設置規則，請參考 `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的 "Target Branch" 章節
- `cr single-ticket --no-draft`：不使用 draft 狀態（預設為 draft）
- `cr single-ticket --no-notify`：停用 Cursor rules 檢查失敗時的系統通知（預設為開啟）

**參數使用範例：**
- `cr single-ticket`：使用預設設定
- `cr single-ticket --reviewer="@john.doe"`：指定 reviewer 為 @john.doe
- `cr single-ticket --target=develop --no-draft`：目標分支為 develop，且不使用 draft 狀態
- `cr single-ticket --no-notify`：停用系統通知功能

**重要：保護現有 Reviewer 規則**
- 如果 MR 已經存在且已有 reviewer，系統會自動檢查：
  - **如果用戶未明確指定 `--reviewer` 參數**（即使用預設值），系統會**保留現有的 reviewer**，不會更新
  - **如果用戶明確指定了 `--reviewer` 參數**（例如：`cr single-ticket --reviewer="@john.doe"`），系統會**更新 reviewer** 為指定的用戶
- 此規則適用於所有 `cr` 系列指令（`cr single-ticket`、`cr multiple-ticket`）

**智能偵測功能（支援跨語系）：**
系統會自動偵測文字描述中的參數相關內容，並詢問是否要設置對應參數。**即使 chat 內容非中文，也能判斷是否包含類似的中文情境。**

1. **關聯單號偵測**：如果提到了單號（例如：`IN-1234`、`FE-5678` 等），系統會自動偵測並詢問
   - 注意：`cr single-ticket` 指令不支援 `--related-tickets` 參數，如果偵測到單號，系統會提示該指令不支援此功能，建議使用 `cr multiple-ticket` 指令

2. **Reviewer 偵測**：如果提到了 reviewer 用戶名（例如：`@john.doe`），系統會自動偵測並詢問是否要設置為 `--reviewer` 參數
   - 中文範例：`cr single-ticket 請讓 @john.doe 審查這個修改` → 系統會自動偵測到 @john.doe
   - 英文範例：`cr single-ticket please let @john.doe review this change` → 系統會自動偵測到 @john.doe

3. **目標分支偵測**：如果提到了目標分支名稱（例如：`develop`、`main` 等），系統會自動偵測並詢問是否要設置為 `--target` 參數
   - 中文範例：`cr single-ticket 這個修改要合併到 develop 分支` → 系統會自動偵測到 develop
   - 英文範例：`cr single-ticket merge this change to develop branch` → 系統會自動偵測到 develop

4. **Draft 狀態偵測**：如果提到了非草稿狀態的意圖，系統會自動偵測並詢問是否要設置 `--no-draft` 參數
   - 中文範例：`cr single-ticket 這個修改直接提交，不要 draft` → 系統會自動偵測到非草稿意圖
   - 英文範例：`cr single-ticket submit this change directly, no draft` → 系統會自動偵測到非草稿意圖

5. **通知設定偵測**：如果提到了不要通知的意圖，系統會自動偵測並設置 `--no-notify` 參數
   - 中文範例：`cr single-ticket 建立 MR，不要通知` → 系統會自動偵測並跳過通知
   - 英文範例：`cr single-ticket create MR without notification` → 系統會自動偵測並跳過通知

**注意：** 
- `cr single-ticket` 指令無法略過送審步驟。如需不送審的流程，請使用 `commit-and-push` 指令。
- `cr single-ticket` 指令不支援 `--related-tickets` 參數，因為它會自動略過關聯單號詢問環節。


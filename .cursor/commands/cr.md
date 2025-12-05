---
description: 快速執行 commit 並建立 MR 的完整流程（強制包含送審）
---

請參考 [auto-commit-and-mr.md](./auto-commit-and-mr.md) 中的 `cr` 指令說明。

當用戶輸入 `cr` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. 從上下文推斷 commit 信息（type, ticket, message）
3. 執行 commit 並推送到遠端
4. 自動建立 MR（包含 FE Board label、reviewer、draft 狀態、delete source branch）
5. **自動提交 AI review**（`cr` 指令強制包含送審功能，無法略過）
6. **自動檢查 Cursor rules**：在執行 commit 之前，AI 會檢查代碼是否符合 Cursor rules。如果檢測到違規，會自動顯示系統通知（macOS/Windows）並自動切換到 Cursor，停止 commit 流程

**參數支持：**
- `cr --reviewer="@username"`：指定 MR reviewer（**僅在用戶明確指定時使用**）
  - **Reviewer 優先順序**：
    1. 命令行參數（`--reviewer=`）：最高優先級，用戶明確指定
    2. 環境變數（`.env.local` 中的 `MR_REVIEWER`）：用戶偏好設置
    3. 預設值（`@william.chiang`）：如果未設置環境變數則使用此值
  - **重要**：AI 自動執行 `cr` 命令時，**不應傳遞 `--reviewer` 參數**，讓腳本自動從環境變數讀取或使用預設值
- `cr --target=branch-name`：指定目標分支（預設: "main"）
- `cr --no-draft`：不使用 draft 狀態（預設為 draft）
- `cr --related-tickets="IN-1235,IN-1236"`：指定關聯單號（多個單號用逗號分隔）
- `cr --no-notify`：停用所有系統通知功能（預設為開啟）。包括：
  - Cursor rules 檢查失敗時的通知
  - Jira 配置缺失時的通知
  - Hotfix MR 確認時的通知
  - 其他需要用戶在 chat 中確認時的通知

**參數使用範例：**
- `cr`：使用預設設定
- `cr --reviewer="@john.doe"`：指定 reviewer 為 @john.doe
- `cr --target=develop --no-draft`：目標分支為 develop，且不使用 draft 狀態
- `cr --reviewer="@john.doe" --related-tickets="IN-1235,IN-1236"`：指定 reviewer 和關聯單號
- `cr --no-notify`：停用系統通知功能

**重要：保護現有 Reviewer 規則**
- 如果 MR 已經存在且已有 reviewer，系統會自動檢查：
  - **如果用戶未明確指定 `--reviewer` 參數**（即使用預設值），系統會**保留現有的 reviewer**，不會更新
  - **如果用戶明確指定了 `--reviewer` 參數**（例如：`cr --reviewer="@john.doe"`），系統會**更新 reviewer** 為指定的用戶
- 此規則適用於所有 `cr` 系列指令（`cr`、`cr-single-ticket`）

**智能偵測功能（支援跨語系）：**
系統會自動偵測文字描述中的參數相關內容，並詢問是否要設置對應參數。**即使 chat 內容非中文，也能判斷是否包含類似的中文情境。**

1. **關聯單號偵測**：如果提到了單號（例如：`IN-1234`、`FE-5678` 等），系統會自動偵測並詢問是否要添加到 `--related-tickets` 參數
   - 中文範例：`cr 這個修改同時修復了 IN-1235 和 IN-1236 的問題` → 系統會自動偵測到 IN-1235 和 IN-1236
   - 英文範例：`cr this fix also resolves IN-1235 and IN-1236` → 系統會自動偵測到 IN-1235 和 IN-1236

2. **Reviewer 偵測**：如果提到了 reviewer 用戶名（例如：`@john.doe`），系統會自動偵測並詢問是否要設置為 `--reviewer` 參數
   - 中文範例：`cr 請讓 @john.doe 審查這個修改` → 系統會自動偵測到 @john.doe
   - 英文範例：`cr please let @john.doe review this change` → 系統會自動偵測到 @john.doe

3. **目標分支偵測**：如果提到了目標分支名稱（例如：`develop`、`main` 等），系統會自動偵測並詢問是否要設置為 `--target` 參數
   - 中文範例：`cr 這個修改要合併到 develop 分支` → 系統會自動偵測到 develop
   - 英文範例：`cr merge this change to develop branch` → 系統會自動偵測到 develop

4. **Draft 狀態偵測**：如果提到了非草稿狀態的意圖，系統會自動偵測並詢問是否要設置 `--no-draft` 參數
   - 中文範例：`cr 這個修改直接提交，不要 draft` → 系統會自動偵測到非草稿意圖
   - 英文範例：`cr submit this change directly, no draft` → 系統會自動偵測到非草稿意圖

5. **通知設定偵測**：如果提到了不要通知的意圖，系統會自動偵測並設置 `--no-notify` 參數
   - 中文範例：`cr 建立 MR，不要通知` → 系統會自動偵測並跳過通知
   - 英文範例：`cr create MR without notification` → 系統會自動偵測並跳過通知

**注意：** `cr` 指令無法略過送審步驟。如需不送審的流程，請使用 `commit-and-push` 指令。


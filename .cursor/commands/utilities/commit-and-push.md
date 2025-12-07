---
description: 快速執行 commit 並推送到遠端，不建立 MR 也不送審
---

請參考 [auto-commit-and-mr.md](./auto-commit-and-mr.md) 中的 `commit-and-push` 指令說明。

當用戶輸入 `commit-and-push` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. 從上下文推斷 commit 信息（type, ticket, message）
3. 執行 commit 並推送到遠端
4. **結束流程**（不建立 MR，不送審）

**注意：** `commit-and-push` 指令僅執行 commit 和 push 操作，不會建立 MR，也不會送審。如需建立 MR 和送審，請使用 `cr` 或 `cr-single-ticket` 指令。

## 執行步驟

### 1. 檢查 Git 狀態
使用 `run_terminal_cmd` 執行 `git status` 檢查是否有變更需要提交：
- 如果沒有變更，告知用戶並結束流程
- 如果有變更，顯示變更的檔案列表

### 2. 獲取當前分支信息
使用 `run_terminal_cmd` 執行 `git rev-parse --abbrev-ref HEAD` 獲取當前分支名稱
- 如果分支是 main/master/develop，提示警告但允許繼續

### 2.5. Rebase to Base Branch（在執行 commit 之前）

**CRITICAL**: 根據 `commit-and-mr-guidelines.mdc` 規範，在執行 commit 之前，**MUST** 先 rebase 到 base branch。

**詳細流程請參考**: `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的 "Pre-Commit Rebase Requirement" 章節。

**執行步驟**：

1. **確定 Base Branch**：
   - 優先從 start-task Git notes 讀取 `sourceBranch`
   - 如果沒有，使用 `git merge-base` 推斷
   - 如果無法推斷，詢問用戶確認

2. **執行 Rebase**：
   ```bash
   git add .
   git stash
   git pull origin {baseBranch} -r
   git stash pop
   ```

3. **處理衝突**（如果有）：
   - 立即停止 commit 流程
   - 通知用戶需要解決衝突
   - 等待用戶確認衝突已解決
   - 進行影響分析
   - 只有當用戶確認後才繼續

**注意**：此步驟必須在 Cursor Rules 檢查之前執行。

### 3. 從上下文推斷 Commit 信息
根據以下優先順序獲取 commit 信息：

**優先順序 1: 用戶明確提供的信息**
- 如果用戶在指令中提供了 commit type、ticket 或 message，使用這些信息
- 例如：「commit-and-push，ticket 是 FE-7838，這是新功能」

**優先順序 2: 從最近的對話或變更推斷**
- 檢查最近修改的檔案和對話內容
- 從 Jira ticket 編號（如 FE-7838）推斷 ticket
- 從變更內容推斷 commit type：
  - 新增功能 → `feat`
  - 修復問題 → `fix`
  - 更新/優化 → `update`
  - 重構代碼 → `refactor`
  - 其他 → `chore`

**優先順序 3: 詢問用戶**
- 如果無法推斷，詢問用戶：
  - Commit type (feat/fix/update/refactor/chore/test/style/revert)
  - Jira ticket (格式: FE-1234)
  - Commit message (小寫，最大 64 字元)

### 4. 驗證 Commit 信息
確保符合 commitlint 規範：
- Type 必須是: feat, fix, update, refactor, chore, test, style, revert
- Ticket 必須符合格式: `[A-Z0-9]+-[0-9]+` (如 FE-7838)
- Message 必須是小寫，最大 64 字元

### 5. 檢查 Cursor Rules（在執行 commit 之前）

**CRITICAL**: 在執行 commit 之前，AI 必須檢查代碼是否符合 Cursor rules。

**核心原則**：
- **不要自動修改代碼**
- **在 chat 中列出所有違規和修正建議**
- **每個改動提供 Apply 按鈕讓用戶選擇性套用**
- **套用完成後繼續原有的 commit 流程**

**處理流程概要**：

1. **檢查範圍**：檢查所有變更的檔案，特別是：
   - 是否符合架構規範（參考 `architecture-overview.mdc`）
   - State management 是否正確（Provider 不應有 side effects、API calls 等）
   - 組件命名和結構是否符合規範
   - 是否有其他 Cursor rules 違規

2. **如果檢測到違規**：
   - **立即停止 commit 流程**
   - **不要自動修改任何代碼**
   - **在 chat 中列出所有違規**，包括：
     - 違規摘要（總數、涉及檔案）
     - 每個違規的詳細信息（檔案、行號、違反規則、問題描述）
     - 修正建議和修正後的代碼示例
     - **每個改動提供 Apply 按鈕**
   - **等待用戶選擇套用修正**：用戶可以選擇套用部分或全部修正
   - **修正完成後繼續 commit 流程**：當用戶完成修正（或選擇跳過）後，繼續執行步驟 6

3. **如果通過檢查**：繼續執行 commit 流程

**最高優先級原則**：必須遵守 [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc) 規則。當檢測到需要修改代碼的問題時，**必須立即停止並詢問用戶**，無論任務目標為何。**先詢問再修改 > 完成任務**。

### 6. 執行 Commit 流程

**前提條件**：必須在執行此步驟之前，先完成 Cursor rules 檢查（見步驟 5）。如果檢測到違規，不要執行 commit。

**方法 A: 使用 agent-commit 腳本（推薦）**

如果已經獲取到所有必要信息（type, ticket, message），且**已確認代碼符合 Cursor rules**，直接使用腳本：

```bash
pnpm run agent-commit --type={type} --ticket={ticket} --message="{message}" --auto-push
```

參數說明：
- `--type`: commit type (feat/fix/update/refactor/chore/test/style/revert)
- `--ticket`: Jira ticket (如 FE-7838)
- `--message`: commit message (小寫，最大 64 字元)
- `--auto-push`: 自動推送到遠端（必須使用此參數）

**方法 B: 手動執行步驟**

如果無法使用腳本，按以下步驟執行：

1. **運行 Lint 檢查（可選但建議）**
   - 詢問用戶是否運行 lint 檢查
   - 如果用戶同意或未明確拒絕，執行 `pnpm run format-and-lint`
   - 如果 lint 失敗，提示用戶修復錯誤後再繼續

2. **添加檔案**
   - 執行 `git add .` 添加所有變更

3. **創建 Commit**
   - 使用格式化的 commit message 創建 commit：
     ```
     {type}({ticket}): {message}
     ```
   - 例如：`feat(FE-7838): enable new sport baseball in stg, dev, and demo environments`
   - 執行：`git commit -m "{commitMessage}"`

4. **推送到遠端**
   - 執行 `git push origin {branch-name}`
   - 如果是新分支，使用 `git push -u origin {branch-name}`

### 7. 結束流程

**重要：** `commit-and-push` 指令僅執行 commit 和 push 操作，**不會建立 MR，也不會送審**。流程到此結束。

如需建立 MR 和送審，請使用 `cr` 或 `cr-single-ticket` 指令。

## Commit Message 範例

根據變更內容自動生成合適的 commit message：

- 新功能：`feat(FE-7838): enable new sport baseball in stg, dev, and demo environments`
- 修復問題：`fix(IN-1234): resolve memory leak in sport game component`
- 更新：`update(FE-5678): upgrade dependencies to latest version`
- 重構：`refactor(IN-9012): refactor sport helper functions for better performance`

**重要：Commit message 必須使用英文，不允許使用中文。**

## 使用範例

**範例 1: 用戶輸入 `commit-and-push`**
```
用戶輸入: "commit-and-push"
1. 自動檢查 git 狀態 → 發現變更
2. 自動從上下文推斷：
   - Type: feat (從變更內容推斷)
   - Ticket: FE-7841 (從分支名稱推斷)
   - Message: add ocr image locale check tool (從變更檔案推斷)
3. 自動執行: pnpm run agent-commit --type=feat --ticket=FE-7841 --message="add ocr image locale check tool" --auto-push
4. `commit-and-push` 指令僅執行 commit 和 push，不建立 MR，也不送審
5. 流程結束
```

**範例 2: 用戶說「commit-and-push，ticket 是 FE-7838」**
```
1. 檢查 git 狀態 → 發現變更
2. 使用用戶提供的 ticket: FE-7838
3. 從變更內容推斷 type 和 message
4. 執行: pnpm run agent-commit --type=feat --ticket=FE-7838 --message="..." --auto-push
5. 流程結束
```

## 注意事項

- ⚠️ 如果 commitlint 驗證失敗，必須重新獲取正確的信息
- ⚠️ 確保 commit message 符合專案規範
- ⚠️ 在 main/master/develop 分支上操作時要特別小心
- ✅ 優先使用 `agent-commit` 腳本，它會自動處理所有驗證和流程
- ✅ `commit-and-push` 指令必須使用 `--auto-push` 參數自動推送到遠端
- ✅ 此指令**不會建立 MR**，如需建立 MR 請使用 `cr` 或 `cr-single-ticket` 指令

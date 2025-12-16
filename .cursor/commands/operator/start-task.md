---
description: 開始新任務：創建 feature branch 並分析 Jira ticket 需求
---

**🚨 重要規則**：執行 start-task 時，必須讀取並遵守 `.cursor/rules/operator/start-task/development-policy.mdc` 規則。

當用戶輸入 `start-task` 時，**所有交互都在 Cursor chat 中完成**，執行以下完整流程：

1. **在 Chat 中詢問用戶信息**：
   - **步驟 1: 詢問 Jira 單號**（必填）
     - 格式：`FE-1234`、`IN-5678` 等
     - 無法省略，必須提供
     - 會驗證格式是否正確
   
   - **步驟 1.5: 檢測是否為子任務**（自動執行）
     - 使用 Jira API 檢查該 ticket 的 `issuetype` 是否為 `Sub-task`
     - 如果是子任務：
       - 自動取得父任務（需求單）單號（從 `parent.key` 欄位）
       - 在 chat 中顯示偵測結果：「偵測到此為子任務，父任務為 {父任務單號}」
       - 記錄兩個單號供後續使用：
         - **分支單號**：父任務單號（用於創建分支）
         - **Commit 單號**：子任務單號（用於 commit scope）
         - **MR 關聯單號**：子任務 + 父任務（兩個都要關聯）
     - 如果不是子任務：
       - 所有單號使用用戶提供的單號
   
   - **步驟 2: 詢問 feature branch 來源分支**（可選，預設為 `main`）
     - 預設值：`main`
     - 用戶可以指定其他分支（例如：`develop`、`release/5.35.0` 等）
     - 如果用戶未指定，使用預設值 `main`

2. **執行 Git 操作**：
   - 檢查來源分支是否存在（本地或遠端）
   - `git checkout {來源分支}` - 切換到指定分支（如果本地不存在但遠端存在，會先 fetch）
   - `git pull origin {來源分支}` - 拉取最新代碼
   - `git checkout -b feature/{分支單號}` - 創建新的 feature branch
     - 若為子任務：使用**父任務單號**（例如：`feature/FE-1234`）
     - 若非子任務：使用用戶提供的單號
   - 如果 feature branch 已存在，會在 chat 中詢問是否要切換到該分支

3. **讀取 Jira ticket 並分析需求**：
   - 使用 Jira API 獲取 ticket 的詳細信息（標題、描述、狀態、負責人、優先級等）
   - 根據 ticket 類型（Feature、Bug、Request 等）初步推斷需求
   - 制定開發計劃（根據 issue type 提供不同的建議步驟）
   - 在 chat 中顯示分析結果和計劃

---

### 🚨 強制停止點 1：開發計劃確認

**CRITICAL**: 在分析完 Jira Ticket 並制定開發計劃後，**必須停止並等待用戶確認**，此步驟**絕對不可跳過**。

**必須輸出的格式**：

```
📋 Jira Ticket 信息
============================================================
單號: {TICKET}
標題: {SUMMARY}
類型: {ISSUE_TYPE}
狀態: {STATUS}

🎯 RD 建議（如有）
============================================================
{RD_SUGGESTION 或 "無"}

🎯 初步開發計劃
============================================================
1. {STEP_1}
2. {STEP_2}
3. {STEP_3}
...

❓ 此開發計劃是否正確？請回覆「confirm」或提供調整建議。
```

**禁止行為**：
- ❌ 未經用戶確認就開始開發
- ❌ 跳過開發計劃顯示步驟
- ❌ 假設用戶會同意而直接開始
- ❌ 在用戶回覆前執行任何代碼修改

**用戶確認後**：才能繼續執行步驟 4（保存開發計劃到 Git notes）

---

4. **🚨 保存開發計劃到 Git notes（強制步驟）**：
   - **CRITICAL**: 當用戶確認計劃後，**必須立即**保存開發計劃到 Git notes
   - 使用腳本保存：
     ```bash
     node .cursor/scripts/operator/save-start-task-info.mjs \
       --ticket="{ticket}" \
       --summary="{標題}" \
       --type="{issueType}" \
       --status="{status}" \
       --assignee="{assignee}" \
       --priority="{priority}" \
       --steps='["步驟1", "步驟2", ...]' \
       --source-branch="{來源分支}" \
       --ai-completed=true
     ```
   - 或使用 JSON 格式：
     ```bash
     node .cursor/scripts/operator/save-start-task-info.mjs --json='{
       "ticket": "{ticket}",
       "summary": "{標題}",
       "issueType": "{issueType}",
       "status": "{status}",
       "assignee": "{assignee}",
       "priority": "{priority}",
       "suggestedSteps": ["步驟1", "步驟2"],
       "sourceBranch": "{來源分支}",
       "featureBranch": "feature/{ticket}",
       "aiCompleted": true
     }'
     ```
   - 驗證保存成功：`node .cursor/scripts/operator/save-start-task-info.mjs --verify`
   - **禁止**在保存成功前開始開發

5. **完成修改後的確認與自動提交流程**：
   - 當 AI 完成代碼修改後，必須在 chat 中與用戶確認目前的修改計畫
   - **讀取開發計劃**：從 Git notes 讀取最新的開發計劃（使用 `git notes --ref=start-task show HEAD`）
   - **顯示修改計畫**：在 chat 中顯示以下內容：
     - 當前分支和 ticket 信息
     - 已完成的開發步驟（基於 Git notes 中的 `suggestedSteps`）
     - 本次修改的摘要（變更的檔案和主要改動）
   - **詢問確認**：詢問用戶「目前的修改計畫是否正確無誤？」

---

### 🚨 強制停止點 2：開發完成確認

**CRITICAL**: 在完成所有代碼修改後，**必須停止並等待用戶確認**，此步驟**絕對不可跳過**。

**必須輸出的格式**：

```
✅ 修改完成！以下是本次修改摘要：

📋 當前任務信息
============================================================
分支: {BRANCH}
Ticket: {TICKET}

✅ 已完成的開發步驟：
1. {STEP_1} ✓
2. {STEP_2} ✓
3. {STEP_3} ✓
...

📝 本次修改摘要：
- 新增檔案: {NEW_FILES}
- 修改檔案: {MODIFIED_FILES}
- 刪除檔案: {DELETED_FILES}
- 主要改動: {CHANGES_SUMMARY}

❓ 目前的修改計畫是否正確無誤？
回覆「confirm」將自動執行 cr 命令提交 MR。
```

**禁止行為**：
- ❌ 未經用戶確認就執行 commit/push
- ❌ 跳過修改摘要顯示步驟
- ❌ 自動執行 cr 命令而不等待確認
- ❌ 假設用戶會同意而直接提交

**用戶確認後**：才能執行 `cr` 命令提交 MR

---

   - **自動執行 cr 命令**：如果用戶確認（回答「是」、「正確」、「可以」、「confirm」等），自動執行 `cr` 命令提交 MR
     - **Commit 規則**：
       - 若為子任務：scope 使用**子任務單號**（例如：`feat(FE-1234-1): ...`）
       - 若非子任務：scope 使用用戶提供的單號
     - **MR 規則**：
       - 若為子任務：MR 需關聯**兩個單號**（子任務 + 父任務），在 MR description 中同時標註
       - 若非子任務：僅關聯用戶提供的單號
       - **關聯單資訊格式**（僅需以下三項）：
         - 單號（含超連結）
         - 標題
         - 類型（Issue Type）

**使用方式：**
- `start-task`：開始新任務，會依次詢問必要信息

**執行範例：**

**範例 1: 一般任務**
```
用戶輸入: start-task

AI: 🚀 開始新任務
    📋 請提供 Jira 單號（格式: FE-1234, IN-5678，必填）：

用戶輸入: FE-7846

AI: 🌿 請指定 feature branch 的來源分支（預設: main，直接回覆分支名稱或按 Enter 使用預設值）：

用戶輸入: main

AI: 📦 正在執行 Git 操作...
    ✅ 已切換到分支: main
    ✅ 已拉取最新代碼
    ✅ 已創建並切換到分支: feature/FE-7846

AI: 📖 正在讀取 Jira ticket FE-7846...
    [在 chat 中顯示 ticket 信息和分析結果]
    [在 chat 中顯示初步開發計劃]
    
    ❓ 請確認計劃是否正確？

用戶輸入: 是

AI: ✅ 計劃已確認，開始開發...
```

**範例 2: 子任務**
```
用戶輸入: start-task

AI: 🚀 開始新任務
    📋 請提供 Jira 單號（格式: FE-1234, IN-5678，必填）：

用戶輸入: FE-7846-1

AI: 🔍 正在檢測 ticket 類型...
    📌 偵測到此為子任務（Sub-task）
    📋 子任務單號: FE-7846-1
    📋 父任務單號: FE-7846
    
    ℹ️ 分支將使用父任務單號: feature/FE-7846
    ℹ️ Commit 將使用子任務單號: (FE-7846-1)
    ℹ️ MR 將關聯兩個單號: FE-7846-1, FE-7846

AI: 🌿 請指定 feature branch 的來源分支（預設: main，直接回覆分支名稱或按 Enter 使用預設值）：

用戶輸入: main

AI: 📦 正在執行 Git 操作...
    ✅ 已切換到分支: main
    ✅ 已拉取最新代碼
    ✅ 已創建並切換到分支: feature/FE-7846（使用父任務單號）

AI: 📖 正在讀取 Jira ticket FE-7846-1...
    [在 chat 中顯示 ticket 信息和分析結果]
    [在 chat 中顯示初步開發計劃]
    
    ❓ 請確認計劃是否正確？

用戶輸入: 是

AI: ✅ 計劃已確認，開始開發...
    📝 提醒：完成後 commit scope 將使用 FE-7846-1，MR 將關聯 FE-7846-1 和 FE-7846
```

**注意事項：**
- Jira 單號為必填項，無法省略
- 如果來源分支不存在，會顯示錯誤並中止流程
- 如果 feature branch 已存在，會提示用戶並詢問是否要切換到該分支
- 需要 Jira API 認證才能讀取 ticket 信息（使用固定的 Jira 配置）
- **子任務處理規則**：
  - 系統會自動偵測 ticket 是否為子任務（檢查 `issuetype` 是否為 `Sub-task`）
  - 子任務的分支命名使用**父任務單號**，避免多個子任務各自建立分支
  - 子任務的 commit scope 使用**子任務單號**，確保追蹤每個子任務的改動
  - 子任務的 MR 需同時關聯**子任務和父任務單號**，方便在 Jira 中追蹤完整需求進度


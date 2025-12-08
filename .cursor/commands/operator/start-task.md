---
description: 開始新任務：創建 feature branch 並分析 Jira ticket 需求
---

當用戶輸入 `start-task` 時，**所有交互都在 Cursor chat 中完成**，執行以下完整流程：

1. **在 Chat 中詢問用戶信息**：
   - **步驟 1: 詢問 Jira 單號**（必填）
     - 格式：`FE-1234`、`IN-5678` 等
     - 無法省略，必須提供
     - 會驗證格式是否正確
   
   - **步驟 2: 詢問 feature branch 來源分支**（可選，預設為 `main`）
     - 預設值：`main`
     - 用戶可以指定其他分支（例如：`develop`、`release/5.35.0` 等）
     - 如果用戶未指定，使用預設值 `main`

2. **執行 Git 操作**：
   - 檢查來源分支是否存在（本地或遠端）
   - `git checkout {來源分支}` - 切換到指定分支（如果本地不存在但遠端存在，會先 fetch）
   - `git pull origin {來源分支}` - 拉取最新代碼
   - `git checkout -b feature/{jira單號}` - 創建新的 feature branch
   - 例如：`git checkout -b feature/IN-1234`
   - 如果 feature branch 已存在，會在 chat 中詢問是否要切換到該分支

3. **讀取 Jira ticket 並分析需求**：
   - 使用 Jira API 獲取 ticket 的詳細信息（標題、描述、狀態、負責人、優先級等）
   - 根據 ticket 類型（Feature、Bug、Request 等）初步推斷需求
   - 制定開發計劃（根據 issue type 提供不同的建議步驟）
   - 在 chat 中顯示分析結果和計劃
   - 在 chat 中詢問用戶確認計劃是否正確

4. **完成修改後的確認與自動提交流程**：
   - 當 AI 完成代碼修改後，必須在 chat 中與用戶確認目前的修改計畫
   - **讀取開發計劃**：從 Git notes 讀取最新的開發計劃（使用 `git notes --ref=start-task show HEAD`）
   - **顯示修改計畫**：在 chat 中顯示以下內容：
     - 當前分支和 ticket 信息
     - 已完成的開發步驟（基於 Git notes 中的 `suggestedSteps`）
     - 本次修改的摘要（變更的檔案和主要改動）
   - **詢問確認**：詢問用戶「目前的修改計畫是否正確無誤？」
   - **自動執行 cr 命令**：如果用戶確認（回答「是」、「正確」、「可以」等），自動執行 `cr` 命令提交 MR

**使用方式：**
- `start-task`：開始新任務，會依次詢問必要信息

**執行範例：**
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

**注意事項：**
- Jira 單號為必填項，無法省略
- 如果來源分支不存在，會顯示錯誤並中止流程
- 如果 feature branch 已存在，會提示用戶並詢問是否要切換到該分支
- 需要 Jira API 認證才能讀取 ticket 信息（使用固定的 Jira 配置）


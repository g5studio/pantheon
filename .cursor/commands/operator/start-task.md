---
description: 開始新任務：創建 feature branch 並分析 Jira ticket 需求
---

<!-- cSpell:disable -->

# start-task

此文件只保留 `start-task` 的主流程與入口互動；模式差異與共用開發 / 交付規則請回到對應 rule。

執行 `start-task` 時，優先遵守：

- `.cursor/rules/operator/start-task/development-policy.mdc`
- `.cursor/rules/operator/start-task/operation-modes.mdc`

## 掛載專案命中規則

**CRITICAL**：在 fluid-two 這類 Pantheon 掛載情境下，先檢查 host 專案 `package.json`：

- 有對應 script：使用 `pnpm run <script> -- <args>`
- 無對應 script：使用 `node .pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs <script-path> <args>`

避免使用硬編碼 Pantheon 腳本路徑（例如 `node .cursor/scripts/<pantheon-script>.mjs`）。

## 主流程

當用戶輸入 `start-task` 時，所有互動都在 Cursor chat 中完成：

1. **先選模式**
2. 詢問 Jira 單號
3. 自動檢查是否為子任務
4. 詢問 feature branch 來源分支（預設 `main`）
5. 執行 Git 操作並建立 `feature/{ticket}`
6. 讀 Jira、產出開發計劃
7. 非快速模式下，**必須**等待用戶確認計劃
8. 保存開發計劃資訊
9. 完成開發後，**必須**再次等待用戶確認修改摘要
10. 用戶確認後，才可進入 `cr` 交付流程

## 模式選擇

在詢問 Jira 單號之前，必須先顯示以下格式：

```text
🚀 開始新任務

請選擇行為模式：

1️⃣ **謹慎模式** (Cautious)
   採最小風險改動，每步確認，適合 Hotfix

2️⃣ **多工模式** (Multi-Task)
   自動讀取所有 Sub-task，分階段開發，最後統一發 MR，適合大項目

3️⃣ **快速模式** (Fast)
   批次排程，目標導向自動推進，適合大量獨立小項目

4️⃣ **預設模式** (Default)
   標準流程，每階段確認

請輸入數字 (1-4) 或模式名稱，直接 Enter 使用預設模式：
```

模式對應：

- `1` / `謹慎` / `cautious` / `hotfix` → 謹慎模式
- `2` / `多工` / `multi` / `multi-task` → 多工模式
- `3` / `快速` / `fast` / `quick` → 快速模式
- `4` / `預設` / `default` / 直接 Enter → 預設模式

顯示完模式選項後，必須**暫停並等待用戶輸入**，不可自行假設模式。

## Jira 與分支規則

- 謹慎模式 / 預設模式：單一 ticket
- 多工模式：主需求單號
- 快速模式：可一次提供多個 ticket
- 來源分支預設 `main`
- 若來源分支不存在，必須停止並回報
- 若 feature branch 已存在，必須先詢問是否切換，並**等待用戶回覆後**再繼續

### 子任務規則

若 Jira `issuetype` 為 `Sub-task`：

- 分支單號：父任務單號
- commit 單號：子任務單號
- MR 關聯單號：子任務 + 父任務
- **快速模式例外**：分支單號使用用戶輸入的單號；commit / MR 關聯仍沿用子任務規則

若不是子任務，全部使用用戶提供的單號。

## 強制停止點 1：開發計劃確認

在分析完 Jira Ticket 並制定開發計劃後，**除快速模式外**，必須停止並等待用戶確認。

必須輸出：

```text
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

禁止：

- 未經用戶確認就開始開發
- 非快速模式跳過計劃顯示
- 假設用戶會同意
- 在用戶回覆前執行代碼修改

此階段在收到明確確認前，必須維持暫停狀態。

## 保存開發計劃

用戶確認後，必須立即保存開發計劃資訊；保存方式遵循 `development-policy.mdc` 與對應腳本規範。保存成功前不得開始開發。

## 強制停止點 2：開發完成確認

在完成所有代碼修改後，**所有模式都必須**先輸出完成摘要並等待用戶確認，才能進入 `cr` 交付；快速模式可在排程確認後自動推進開發，但最後仍必須做一次集中完成確認。

必須輸出：

```text
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

禁止：

- 未經用戶確認就執行 commit / push
- 跳過修改摘要顯示
- 自動執行 `cr` 命令而不等待確認
- 假設用戶會同意而直接提交

此階段在收到明確確認前，必須維持暫停狀態；快速模式的差異只在於前段可自動推進，但最終交付前仍要依 `fast-mode.mdc` 的集中回報格式完成確認。

## 自動進入交付

如果用戶確認（如「是」、「正確」、「可以」、「confirm」），才可進入 `cr` 流程；快速模式的排程確認是開發授權點，但**不是**略過最終完成確認的授權點：

- 若為子任務：commit scope 使用子任務單號
- 若為子任務：MR 需同時關聯子任務與父任務
- 若非子任務：僅關聯用戶提供的單號

建立 MR 前，開發報告至少要包含：

- `## 📋 關聯單資訊`
- `## 📝 變更摘要`
- `### 變更內容`
- `## ⚠️ 風險評估`

固定補充規則：

- `Bug`：必須包含 `## 🔍 影響範圍`、`## 🔬 根本原因`，且根本原因區塊必須包含「造成單號」
- `Request`：必須包含 `## ✅ 預期效果（Request）`、`## 📌 需求覆蓋率`、`## ⚠️ 潛在影響風險報告`
- 所有類型都必須在報告最下方保留 `### 🤖 Agent Version` 區塊
- `### 🤖 Agent Version` 區塊必須位於報告最底部，不可省略

禁止：

- 只傳 ticket 或零散摘要，未包含完整報告區塊
- 缺少風險評估表格
- 直接把 commit message 當作 development report 傳入
- 漏掉 `Bug` / `Request` 專屬區塊
- 漏掉報告最下方的 `### 🤖 Agent Version` 區塊

其餘欄位細節與 Markdown 完整性要求，遵循 `commit-and-mr-guidelines.mdc`。

## 注意事項

- Jira 單號為必填，不能省略
- 快速模式的授權點是排程確認，不是逐張計劃確認
- 回應格式需沿用既有 emoji 與提示文字，不要自行改寫成更冷淡的簡化版

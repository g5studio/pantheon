---
description: 處理 MR 中 AI review 的 comments：分析建議、代理修正、回覆並重新送審
---

當用戶輸入 `fix-comment` 時，**所有交互都在 Cursor chat 中完成**，執行以下完整流程：

## 流程說明

### 1. 詢問 MR 連結

- **步驟 1: 詢問 MR URL**（必填）
  - 格式：`https://gitlab.service-hub.tech/{project}/-/merge_requests/{id}`
  - 範例：`https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366`
  - 無法省略，必須提供
  - 會驗證格式是否正確

### 2. 獲取 AI Review Comments

使用腳本獲取所有由 `@service_account_8131c1c3f99badd3c4938c05fa68088b` 發布的**尚未解決**的 MR comments：

```bash
node .cursor/scripts/operator/fix-comment.mjs list "<MR_URL>"
```

**注意**：如果專案是以 submodule 形式掛載 Pantheon，請使用：
```bash
node .pantheon/.cursor/scripts/operator/fix-comment.mjs list "<MR_URL>"
```

### 3. 讀取專案 Rules（必要前置步驟）

**CRITICAL**: 在判斷任何 AI review 建議之前，AI **必須**先讀取並理解專案的所有 Cursor rules：

1. **查找專案的 rules 目錄**：
   - 檢查 `.cursor/rules/` 目錄
   - 如果專案是 submodule 掛載，同時檢查 `.pantheon/.cursor/rules/`

2. **讀取所有相關 rules**：
   - 讀取架構相關規則（如 `architecture.mdc`、`code-style.mdc` 等）
   - 讀取專案特定的慣例和規範
   - 理解專案的設計模式和約定

3. **建立專案理解**：
   - 根據 rules 理解專案的架構決策
   - 了解哪些做法是被允許的、哪些是被禁止的
   - 掌握專案的命名慣例、檔案組織方式等

### 4. 逐一處理每個 Comment

**🚨 CRITICAL - 強制逐項確認**：

**必須**採用「一個一個」的處理方式，**絕對禁止**批次處理：

**強制流程**：
1. 呈現**單一** comment 的分析
2. 詢問用戶是否要修正
3. **【強制停止】等待用戶回應**
4. 執行用戶選擇
5. **只有在用戶回應後**，才能繼續處理下一個 comment

**禁止行為**：
- ❌ 一次性列出所有 comments 的分析
- ❌ 統一詢問「以上是否要修正」
- ❌ 在用戶未回應當前 comment 前就呈現下一個
- ❌ 假設用戶想要批次處理以提高效率

---

對於每個未解決的 AI review comment，AI 必須：

1. **讀取 Comment 內容**：
   - 分析 comment 指出的問題
   - 如果 comment 提到特定檔案和行號，讀取相關代碼上下文

2. **理解並判斷建議**（基於專案 Rules 的綜合判斷）：
   - **必須結合專案 rules** 判斷 AI review 的建議是否合理且需要修正
   - 考慮因素：
     - 建議是否符合專案 **自定義的架構規範**（參考已讀取的 rules）
     - 建議是否與專案 **既有的設計模式和慣例** 一致
     - 建議是否能改善代碼品質
     - 建議是否有技術正確性
     - 建議是否與專案的 **Cursor rules 中的規範** 衝突或一致
   
   **判斷優先級**：
   - 專案自定義 rules > 通用最佳實踐 > AI review 建議
   - 如果 AI review 建議與專案 rules 衝突，應標記為「不建議採納」並說明原因

3. **在 Chat 中整理方案**：
   - 向用戶呈現：
     - Comment 的原始內容
     - 涉及的檔案和行號
     - AI 對建議的分析（是否合理、是否需要修正）
     - 如果需要修正，提供具體的修正方案
   - 詢問用戶是否要代理執行修正

4. **執行用戶選擇**：

   **情況 A：用戶同意修正**
   - AI 代理執行代碼修改
   - **不需要**對 MR comment 做任何回覆
   - **不要 resolve**：Operator 不應自行將 comment 設為 resolved，resolve 權限由 agent reviewer (compass) 負責
   - 繼續處理下一個 comment

   **情況 B：用戶認為毋須修正並提供原因**
   - 使用用戶提供的原因回覆該 comment：
     ```bash
     node .cursor/scripts/operator/fix-comment.mjs reply "<MR_URL>" "<DISCUSSION_ID>" "<用戶提供的原因>"
     ```
   - **不要 resolve**：回覆後由 agent reviewer (compass) 判斷是否 resolve
   - 繼續處理下一個 comment

   **情況 C：用戶要求跳過**
   - 不做任何處理
   - 繼續處理下一個 comment

### 5. 完成後重新送審

當所有 comments 都處理完畢後：

1. **如果有任何代碼修改**：
   - 詢問用戶是否要 commit 並推送
   - 如果同意，執行 `cr single-ticket` 或類似的 commit 流程

2. **重新提交 AI review**（必須執行）：
   - **無論是否有代碼修改**，在與用戶確認過所有 comment 後，都必須重新提交 AI review
   - 這確保 agent reviewer (compass) 能重新審核並判斷是否 resolve 各個 comment
   ```bash
   node .cursor/scripts/operator/fix-comment.mjs resubmit "<MR_URL>"
   ```

## 腳本命令參考

| 命令 | 說明 | Operator 可用 | 範例 |
|------|------|:------------:|------|
| `list` | 列出所有未解決的 AI review comments | ✅ | `node fix-comment.mjs list "<MR_URL>"` |
| `reply` | 回覆指定的 comment | ✅ | `node fix-comment.mjs reply "<MR_URL>" "<DISCUSSION_ID>" "<內容>"` |
| `resolve` | 解決（標記為已解決）指定的 comment | ❌ | `node fix-comment.mjs resolve "<MR_URL>" "<DISCUSSION_ID>"` |
| `resubmit` | 重新提交 AI review | ✅ | `node fix-comment.mjs resubmit "<MR_URL>"` |

**⚠️ 重要說明**：`resolve` 命令僅供 agent reviewer (compass) 使用，Operator 不應該自行將 comment 標記為 resolved。

## 使用方式

- `fix-comment`：開始處理 MR 的 AI review comments

## 執行範例

```
用戶輸入: fix-comment

AI: 🔧 開始處理 MR AI Review Comments
    📋 請提供 MR URL：

用戶輸入: https://gitlab.service-hub.tech/frontend/fluid-two/-/merge_requests/3366

AI: 🔍 正在獲取 MR !3366 的 AI review comments...
    📋 MR 標題: feat(FE-7846): add new feature
    🌿 來源分支: feature/FE-7846
    
    ⚠️ 發現 3 個未解決的 AI review comments
    
    📚 正在讀取專案 Cursor Rules...
    ✅ 已讀取以下 rules：
       - .cursor/rules/architecture.mdc
       - .cursor/rules/code-style.mdc
       - .cursor/rules/cr/commit-and-mr-guidelines.mdc
       ... (共 N 個 rules)

    ───────────────────────────────────────
    【Comment 1/3】
    📁 檔案: src/components/Button.tsx
    📍 行號: 42
    
    💬 Comment 內容:
    建議將 `useState` 改為 `useReducer` 以處理複雜的狀態邏輯...
    
    🤖 AI 分析（基於專案 Rules）:
    - 合理性: ✅ 合理
    - 專案 Rules 參考: 根據 `architecture.mdc` 中的狀態管理規範
    - 分析: 當前狀態邏輯確實較複雜，使用 useReducer 可以提高可維護性，
            且符合專案的狀態管理慣例
    - 建議方案: [具體修改方案]
    
    ❓ 是否要代理執行此修正？(是/否/跳過)

用戶輸入: 是

AI: ✅ 正在執行修正...
    [執行代碼修改]
    ✅ 修正完成（待重新送審後由 agent reviewer 確認）
    
    ───────────────────────────────────────
    【Comment 2/3】
    📁 檔案: src/utils/helper.ts
    📍 行號: 15
    
    💬 Comment 內容:
    建議添加空值檢查...
    
    🤖 AI 分析（基於專案 Rules）:
    - 合理性: ⚠️ 不建議採納
    - 專案 Rules 參考: 根據 `code-style.mdc` 中的防禦性編程規範
    - 分析: 專案規範明確指出「避免重複的 null check」，此處已有上層的
            null check，額外檢查違反了專案的 DRY 原則
    
    ❓ 是否要代理執行此修正？(是/否/跳過)

用戶輸入: 否，上層已有檢查，這裡不需要重複

AI: 💬 正在回覆此 comment...
    已回覆: "上層已有檢查，這裡不需要重複"
    
    ───────────────────────────────────────
    【Comment 3/3】
    ...

    ═══════════════════════════════════════
    📊 處理完成摘要:
    - 已修正（代碼調整）: 2 個
    - 不採納（已回覆原因）: 1 個
    - 跳過: 0 個
    
    ⚠️ 注意: 未自動 resolve 任何 comment
    Resolve 將由 agent reviewer (compass) 在重新審核後決定
    
    ❓ 是否要 commit 並推送修改？

用戶輸入: 是

AI: [執行 cr single-ticket 流程]
    ✅ 已推送修改
    
    🤖 正在重新提交 AI review...
    ✅ AI review 已提交
```

## 注意事項

1. **必須先讀取專案 Rules**：在判斷任何建議之前，**必須**先讀取專案的所有 Cursor rules，確保判斷是基於專案的實際規範
2. **專案 Rules 優先**：當 AI review 建議與專案 rules 衝突時，應以專案 rules 為準，並向用戶說明衝突原因
3. **只處理特定 Service Account 的 Comments**：只會處理由 `@service_account_8131c1c3f99badd3c4938c05fa68088b` 發布的 comments
4. **只處理未解決的 Comments**：已解決的 comments 會被跳過
5. **需要 GitLab Token**：需要有有效的 GitLab token 才能執行操作
6. **需要 Compass API Token**：重新送審需要有效的 Compass API token
7. **遵循決策優先級規則**：必須遵守 `ai-decision-making-priorities.mdc` 規則，所有修改都需要用戶確認
8. **Resolve 權限限制**：**Operator 不應自行將 comment 標記為 resolved**。Resolve 權限專屬於 agent reviewer (compass)，由 compass 在重新審核時決定是否 resolve
9. **回覆時機**：只有在用戶認為不需要修正並提供原因時，才需要回覆 comment。若用戶同意修正，Operator 只需執行代碼修改，不需要回覆 comment

## 相關規則

- [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc)：所有修改必須先詢問用戶
- [commit-and-mr-guidelines.mdc](mdc:.cursor/rules/cr/commit-and-mr-guidelines.mdc)：commit 和 MR 相關規範
- [@troubleshooting-guide.mdc (1-199)](mdc:.cursor/rules/troubleshooting-guide.mdc)：錯誤處理 SOP（所有既定程序遇到問題時，必須第一時間先依此指南排查）


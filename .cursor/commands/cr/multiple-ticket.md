---
description: 快速執行 commit 並建立 MR 的完整流程，必須提供多於一個 Jira ticket（預設送審，可用 --no-review 跳過）
---

# cr multiple-ticket

此文件只保留 `cr multiple-ticket` 的專屬規則。共用 commit / MR 流程請遵守：
- [auto-commit-and-mr.md](../utilities/auto-commit-and-mr.md)
- [commit-and-mr-guidelines.mdc](mdc:.cursor/rules/cr/commit-and-mr-guidelines.mdc)
- [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc)

## 核心行為

當用戶輸入 `cr multiple-ticket` 時：

1. 檢查 Git 狀態
2. **先驗證是否為多 ticket**
3. 從上下文推斷 commit 信息（type, ticket, message）
4. 執行 commit 並推送到遠端
5. **先判定是建立新 MR 還是更新既有 MR**
6. 若為新 MR，建立 draft MR；若為既有 MR 更新，改走 `update-mr`
7. **預設提交 AI review**；只有用戶明確要求時才使用 `--no-review`

## 強制要求

`cr multiple-ticket` **必須**包含多於一個 Jira ticket：

- 當前分支單號
- 至少一個關聯單號，或由子任務自動補齊

如果只有一個 ticket，應停止並提示：

```text
⚠️ `cr multiple-ticket` 指令必須提供多於一個 Jira ticket。

請選擇：
1. 提供關聯單號（手動輸入）
2. 自動獲取當前分支單號的所有子任務
3. 改用 `cr single-ticket` 指令（僅使用當前分支單號）
```

顯示上述提示後，必須**暫停並等待用戶選擇**，不可自行決定下一步。

## 子任務意圖

如果用戶表達「主單 + 所有子任務」之類意圖，必須先確認，再讀取當前主單的子任務，列出結果後再次確認是否全部作為 `--related-tickets`。

確認訊息使用：

```text
偵測到您的意圖可能是「以當前主單與所有關聯子任務進行」。
當前分支單號: {CURRENT_TICKET}

請確認：
1. 是，自動獲取 {CURRENT_TICKET} 的所有子任務並作為關聯單號
2. 否，我會手動提供關聯單號
```

若沒有子任務，必須回報並請用戶改用手動提供關聯單號。

在這兩個確認點都必須**暫停並等待用戶回覆**，不可自動帶入 `--related-tickets`。

## 專屬規則

- `--related-tickets` 是此指令的主要輸入方式
- reviewer 只有在用戶**明確指定**時才傳 `--reviewer`
- target branch 只有在用戶**明確指定**時才傳 `--target`
- 非 draft / 不送審 / 不通知都只有在用戶**明確要求**時才傳參數
- 若 MR 已有 reviewer，且用戶未明確覆蓋，保留既有 reviewer
- 若從自然語言偵測到 reviewer / target branch / 非 draft / 不送審 / 不通知等候選意圖，先向用戶確認，再決定是否帶入對應參數

## 共享但仍必須執行

以下行為不要在此重複展開，但執行時不可省略：

- 建立 MR 前先完成 create / update 路由判斷
- commit 前檢查 Cursor rules
- Bug 類型強制追溯來源
- 產生不跑版的 `--development-report`
- 補齊 labels / agent version
- 依 [mr-execution-result-report.mdc](mdc:.cursor/rules/cr/mr-execution-result-report.mdc) 的格式回報結果

## 範例

- `cr multiple-ticket --related-tickets="IN-1235,IN-1236"`
- `cr multiple-ticket 這個改動包含所有子任務`
- `cr multiple-ticket --reviewer="@john.doe" --related-tickets="IN-1235,IN-1236"`
- `cr multiple-ticket --target=develop --no-draft --related-tickets="IN-1235"`

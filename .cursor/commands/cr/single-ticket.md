---
description: 快速執行 commit 並建立 MR，略過關聯單號詢問（預設送審，可用 --no-review 跳過）
---

# cr single-ticket

此文件只保留 `cr single-ticket` 的專屬規則。共用 commit / MR 流程請遵守：
- [auto-commit-and-mr.md](../utilities/auto-commit-and-mr.md)
- [commit-and-mr-guidelines.mdc](mdc:.cursor/rules/cr/commit-and-mr-guidelines.mdc)
- [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc)

## 核心行為

當用戶輸入 `cr single-ticket` 時：

1. 檢查 Git 狀態
2. 從上下文推斷 commit 信息（type, ticket, message）
3. 執行 commit 並推送到遠端
4. **略過關聯單號詢問**，直接使用當前分支單號
5. **先判定是建立新 MR 還是更新既有 MR**
6. 若為新 MR，建立 draft MR；若為既有 MR 更新，改走 `update-mr`
7. **預設提交 AI review**；只有用戶明確要求時才使用 `--no-review`

## 專屬規則

- 只使用當前分支單號；**不支援** `--related-tickets`
- 若文字描述提到其他 ticket，應提示改用 `cr multiple-ticket`，並**暫停等待用戶決定**
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

- `cr single-ticket`
- `cr single-ticket --reviewer="@john.doe"`
- `cr single-ticket --target=develop --no-draft`
- `cr single-ticket --no-notify`

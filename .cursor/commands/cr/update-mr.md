---
description: 更新現有 MR（讀寫 merge-request-description-info.json、merge 內容避免重複、預設會審核但僅限 new commit）
---

<!-- cspell:disable -->

當用戶需要 **修改現有 MR**（更新 description / 開發報告 / 追加資訊）時，**必須**使用此流程：

## 核心原則

- **create-mr 只用於建立新 MR**；任何 MR 更新行為一律走 `update-mr.mjs`
- MR description 資訊來源為 `.cursor/tmp/{ticket}/merge-request-description-info.json`（schema: `{ plan, report }`），並由固定模板渲染到 MR description
- **不得自動產出任何檔案**，除 `merge-request-description-info.json`
- 更新 description 以 merge 的概念進行（marker-based），避免報告重複
- **用戶可要求不審核**（`--no-review`）
- **若缺少 `COMPASS_API_TOKEN`，則會自動跳過 AI review**（其餘 MR 更新流程照常）
- **未特別說明時預設要審核**，但前提是「相對於上次已送審狀態」有 new commit；否則不送

## 使用方式

```bash
node .cursor/scripts/cr/update-mr.mjs
```

### 可選參數

- `--no-review`：明確跳過 AI review（即使有 new commit 也不送）

### 檔案位置

更新後的開發報告 JSON 會寫回：

- `.cursor/tmp/{jira ticket number}/merge-request-description-info.json`

> `{jira ticket number}` 從當前分支名稱提取（例如 `feature/FE-1234` → `FE-1234`）。


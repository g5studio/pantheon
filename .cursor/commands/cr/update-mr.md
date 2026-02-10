---
description: 更新現有 MR（不產生實體檔案、merge 內容避免重複、預設會審核但僅限 new commit）
---

<!-- cspell:disable -->

當用戶需要 **修改現有 MR**（更新 description / 開發報告 / 追加資訊）時，**必須**使用此流程：

## 核心原則

- **create-mr 只用於建立新 MR**；任何 MR 更新行為一律走 `update-mr.mjs`
- 開發報告**優先**透過 `--development-report` 傳入；若未提供，會依序嘗試讀取：
  - `--development-report-file=<path>`
  - `.cursor/tmp/development-report.md`
- 更新 description 以 merge 的概念進行（marker-based），避免報告重複
- **用戶可要求不審核**（`--no-review`）
- **若缺少 `COMPASS_API_TOKEN`，則會自動跳過 AI review**（其餘 MR 更新流程照常）
- **未特別說明時預設要審核**，但前提是「相對於上次已送審狀態」有 new commit；否則不送
- 若提供/存在 start-task 檔案化產物（同 ticket 且存在 plan/report 檔案），會在更新 MR 時自動補上 `AI` label（不會移除既有 labels）
- MR 更新成功後，會清理 `.cursor/tmp` 對應的暫存檔案（可用參數關閉）

## 使用方式

```bash
node .cursor/scripts/cr/update-mr.mjs \
  --development-report="$(cat <<'EOF'
## 📋 關聯單資訊

| 項目 | 值 |
|---|---|
| **單號** | [FE-7910](https://innotech.atlassian.net/browse/FE-7910) |
| **標題** | ... |
| **類型** | ... |

---

## 📝 變更摘要

...

### 變更內容

| 檔案 | 狀態 | 說明 |
|---|---|---|
| `path/to/file.ts` | 更新 | ... |

---

## ⚠️ 風險評估

| 檔案 | 風險等級 | 評估說明 |
|---|---|---|
| `path/to/file.ts` | 中度 | ... |
EOF
)"
```

### 可選參數

- `--no-review`：明確跳過 AI review（即使有 new commit 也不送）
- `--development-report-file=<path>`：從檔案讀取開發報告 markdown（可相對於專案根目錄）
- `--start-task-info-file=<path>`：指定 `.cursor/tmp/start-task-info.json` 路徑（供上層 start-task 擴充傳入）
- `--development-plan-file=<path>`：指定 `.cursor/tmp/development-plan.md` 路徑（供 AI label / cleanup 判斷）
- `--development-report-file=<path>`：指定 `.cursor/tmp/development-report.md` 路徑（供讀取/AI label/cleanup 判斷）
- `--no-cleanup-start-task-artifacts`：更新 MR 成功後不清理 `.cursor/tmp` 暫存檔案


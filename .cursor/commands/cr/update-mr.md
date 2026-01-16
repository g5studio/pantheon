---
description: 更新現有 MR（不產生實體檔案、merge 內容避免重複、預設會審核但僅限 new commit）
---

<!-- cspell:disable -->

當用戶需要 **修改現有 MR**（更新 description / 開發報告 / 追加資訊）時，**必須**使用此流程：

## 核心原則

- **create-mr 只用於建立新 MR**；任何 MR 更新行為一律走 `update-mr.mjs`
- 開發報告一律透過 `--development-report` 傳入，**不得產出任何實體檔案**
- 更新 description 以 merge 的概念進行（marker-based），避免報告重複
- **用戶可要求不審核**（`--no-review`）
- **若缺少 `COMPASS_API_TOKEN`，則會自動跳過 AI review**（其餘 MR 更新流程照常）
- **未特別說明時預設要審核**，但前提是「相對於上次已送審狀態」有 new commit；否則不送

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


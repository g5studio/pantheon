---
description: 批次檢查/合併 MR，並切換 Jira 狀態（可自訂參數）
---

# batch-merge-mrs（批次合併 MR + Jira transition）

此指令用於批次處理符合條件的 GitLab MR，流程包含：

- 檢查 MR 是否有衝突（conflict）
- 依 `--labels` 過濾目標清單（例如 `v5.38`）
- 檢查 Jira（從 MR title/description 抓 ticket）並推導 **預期 UI label**（`3.0UI` / `4.0UI`），若 MR labels 不含該 UI label 則略過
- 檢查是否已通過 approve（可要求必須包含指定 user 的核准）
- **符合條件才合併**
- 合併後將 Jira 主單狀態切到指定狀態（預設：`PENDING DEPLOY STG`）

## 執行方式

當用戶輸入 `batch-merge-mrs` 時，**AI 必須先用 Answer 視窗讓用戶選擇參數**，確認後才可執行腳本。

### 互動式流程（強制）

1. **先用 Answer 視窗讓用戶選 flags**（至少要確認以下四項）
   - **labels（必要）**：要處理哪個版本標籤？（例如 `v5.38` / `v5.39`）
   - **approval（必要，二選一）**
     - 需要 approvals：`--approved-by=<username>`
     - 不檢查 approvals：`--no-approval-check`
   - **jira transition（必要，二選一）**
     - 要切 Jira 狀態：`--jira-to="<status>"`
     - 不切 Jira 狀態：`--no-jira-transition`
   - **action（必要，二選一）**
     - 只看清單：`--dry-run`
     - 真正合併：`--execute`

> 🚨 安全設計：此腳本已改為「缺少必要 flags 就直接退出」，避免吃到隱含預設造成誤合併/誤切 Jira。

2. **建議流程**：即使你最後要合併，也請先跑一次 `--dry-run`（Answer 視窗選 `--dry-run`），確認清單無誤後再用 `--execute` 重跑

3. **將 dry-run 結果整理回報給用戶**（建議用表格列出 `merged/conflicts/skipped/errors`）

4. 若用戶選擇要合併（`--execute`），**AI 必須再次用 Answer 視窗讓用戶確認**才可執行（避免誤觸）

### 實際執行命令

當用戶確認參數後，AI 才執行以下腳本（可附帶 flags）：

```bash
node .cursor/scripts/admin/batch-merge-mrs.mjs <flags...>
```

> **注意**：此腳本依賴本機已登入 `glab`（對應 GitLab host），以及 `.cursor/.env.local` 內的 Jira 認證（`JIRA_EMAIL`, `JIRA_API_TOKEN`）。

### 🚨 權限要求

此流程需要呼叫 GitLab API、合併 MR、呼叫 Jira API 做狀態切換。
AI 執行時請使用可連網權限（建議 `required_permissions: ["all"]`）。

## 參數（flags）

- `--host=gitlab.service-hub.tech`：GitLab host
- `--project=:id`：GitLab project（預設用 `:id`，依據當前 repo 自動解析）
- `--state=opened`：MR state（預設 `opened`）
- `--labels=v5.38`：MR labels 過濾（逗號分隔）
- `--order-by=merged_at`：排序欄位（用於與列表一致）
- `--sort=desc`：排序方向
- `--per-page=100`：每次抓取數量（GitLab 通常上限 100）
- `--delay=1.5`：每筆合併前延遲秒數（節流，避免 GitLab 壓力）
- `--jira-to="PENDING DEPLOY STG"`：合併後要切換到的 Jira 狀態
- `--approved-by=william.chiang`：要求 approvals 必須包含該 username
- `--dry-run`：只列出會處理/會合併的清單，不實際合併、不切 Jira
- `--execute`：真正合併（建議先跑 `--dry-run` 確認清單）
- `--no-jira-transition`：不做 Jira 狀態切換
- `--no-approval-check`：不檢查 approvals（不建議）
- `--no-skip-draft`：不略過 Draft MR（預設會略過）
- `--max-process=200`：最多處理 N 筆（0 = 不限制）
- `--max-iterations=1000`：最多迭代次數（避免清單不變造成無限迴圈）

## 使用範例

### 範例 1：依 v5.38 清單批次合併（節流 1.5s）

```bash
node .cursor/scripts/admin/batch-merge-mrs.mjs \
  --labels=v5.38 \
  --per-page=100 \
  --delay=1.5 \
  --approved-by=william.chiang \
  --jira-to="PENDING DEPLOY STG" \
  --execute
```

### 範例 2：Dry-run（只看會合併哪些）

```bash
node .cursor/scripts/admin/batch-merge-mrs.mjs \
  --labels=v5.38 \
  --approved-by=william.chiang \
  --jira-to="PENDING DEPLOY STG" \
  --dry-run
```

## 輸出

腳本輸出為 JSON，包含：
- `merged`: 已合併清單（含對應 Jira ticket）
- `conflicts`: 有衝突清單（需人工處理）
- `skipped`: 略過清單與原因（Draft / Not approved / Label mismatch / Jira read failed…）
- `errors`: 合併後 Jira transition 失敗等非致命錯誤


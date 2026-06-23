---
description: 以 mounted-safe 方式快速查詢檔案，優先使用 CodeGraph（外部工具），並在不可用時自動回退本地索引流程
---

## query-file - 檔案查詢加速工具

`query-file` 提供「外部工具優先」的查詢流程：

1. 先嘗試使用 CodeGraph（優先本機 `codegraph`，否則自動改用 `npx @colbymchenry/codegraph`）
2. 若 CodeGraph 不可用或無結果，自動回退到本地索引（`query-file-index.json`，位於專案根目錄）
3. 若結果不足，再回退到 `rg` 內容搜尋（高準確）

此流程可在 Pantheon 本體與 mounted 專案共用。

> 全域策略：掛載 Pantheon 後，檔案查詢應以 `query-file` 作為預設入口，避免一開始就做全量 grep/file 掃描。

---

## 使用方式

```bash
pnpm run query-file -- --keyword=<text>
```

或簡寫：

```bash
pnpm run query-file -- <keyword>
```

---

## 常用參數

| 參數 | 說明 |
|---|---|
| `-k, --keyword=<text>` | 查詢關鍵字（檔名或路徑片段） |
| `--path=<a,b,c>` | 限制查詢目錄（逗號分隔） |
| `-n, --limit=<number>` | 結果上限（預設 20，最大 200） |
| `--provider=<auto\|codegraph\|local>` | 查詢 provider（預設 `auto`） |
| `--reindex` | 查詢前強制重建索引 |
| `--index-only` | 只重建索引，不做查詢 |
| `--no-content` | 停用內容搜尋回退（只用索引） |
| `--json` | 以 JSON 輸出結果 |

---

## 範例

```bash
# 查詢檔名 / 路徑
pnpm run query-file -- jira-content-formatter

# 指定範圍查詢
pnpm run query-file -- --keyword=update-jira --path=.cursor/scripts/jira

# 強制走 CodeGraph（不可用時會顯示 fallback 訊息）
pnpm run query-file -- --keyword=update-jira --provider=codegraph

# 僅重建索引
pnpm run query-file -- --reindex --index-only
```

---

## mounted 專案行為

- 入口透過 `run-pantheon-script.mjs` 執行，會自動做路徑 fallback。
- `pantheon:descend` / `pantheon:oracle` 會嘗試自動初始化 CodeGraph（best effort）。
- 若 mounted 專案已安裝 CodeGraph 且執行過 `codegraph init`（存在 `.codegraph/`），會直接生效。
- 若 mounted 專案尚未安裝本機 `codegraph`，`query-file` 會自動嘗試 `npx @colbymchenry/codegraph`。
- 若 mounted 專案尚未具備 CodeGraph 環境，會自動回退本地索引，不中斷查詢流程。
- 索引檔寫在目標專案根目錄的 `query-file-index.json`，每個 mounted 專案可獨立快取，不互相污染。

## CodeGraph 生效條件

| 條件 | 說明 |
|---|---|
| Runtime 可用 | 可執行 `codegraph --version` 或 `npx @colbymchenry/codegraph --version` |
| 專案已初始化 | 專案根目錄存在 `.codegraph/`（通常由 `codegraph init` 產生） |
| 查詢入口一致 | 仍使用 `pnpm run query-file -- ...`，不需改既有 Pantheon 入口 |

---
description: 將 pantheon 的 commands/scripts/skills 複製安裝到專案中
---

# Oracle - Pantheon Cursor 同步指令

此指令會自動將 `.pantheon/.cursor` 的內容複製安裝到專案的 `.cursor/*/<install-name>/` 與 `.agents/*/<install-name>/` 目錄中，並拉取用戶初始化時設置的分支最新內容。

## 執行方式

當用戶輸入 `oracle` 時，AI 執行以下腳本：

```bash
node .pantheon/.cursor/scripts/utilities/oracle.mjs
```

> **注意**：此腳本需要在專案根目錄執行，且專案必須包含 `.pantheon` 資料夾（透過 `pantheon:descend` 安裝）。

## 執行流程

腳本會依序執行以下步驟：

### 1. 檢查 .pantheon 是否存在

如果 `.pantheon/.cursor` 不存在，提示用戶執行 `npm run pantheon:descend` 安裝 Pantheon 並結束流程。

### 2. 拉取 pantheon 當前分支最新內容

- 取得 pantheon 當前分支（用戶初始化時透過 `--deities` 設置的分支）
- 若有本地變更，自動重置
- 執行 `git fetch` 和 `git pull` 拉取最新內容

### 3. 建立 .cursor / .agents 目錄結構

建立以下目錄（如果不存在）：
- `.cursor/commands/`
- `.cursor/rules/`
- `.cursor/scripts/`
- `.cursor/skills/`
- `.agents/commands/`
- `.agents/scripts/`
- `.agents/skills/`

### 4. 複製安裝 Pantheon 內容

將 `.pantheon/.cursor` 對應內容複製到專案本地安裝目錄：
- `.cursor/commands/<install-name>`
- `.cursor/rules/<install-name>`
- `.cursor/scripts/<install-name>`
- `.cursor/skills/<install-name>`
- `.agents/commands/<install-name>`
- `.agents/scripts/<install-name>`
- `.agents/skills/<install-name>`

每次執行都會重建上述安裝目錄；請不要在這些目錄中手動修改檔案，否則下一次 `oracle` 會覆蓋。

### 5. 更新 .gitignore

自動將 `.pantheon/`、`.cursor/.env.local`、`.cursor/.../<install-name>/` 與 `.agents/.../<install-name>/` 加入專案 `.gitignore`，避免 Pantheon 安裝產物與本地環境變數被提交到目標專案；ignore 範圍只涵蓋 Pantheon installed copy 與 `.cursor/.env.local`，不會忽略 `.cursor` 或 `.agents` 內其他專案自有項目。

### 6. 自動準備 CodeGraph（best effort）

在不改變使用者操作習慣前提下，`oracle` 會嘗試自動準備 CodeGraph 查詢能力（與 `descend` 共用同一套 `codegraph-setup.mjs` 邏輯）：

- 在 pull 最新 Pantheon 後**動態載入** `.pantheon/.cursor/scripts/utilities/codegraph-setup.mjs`，確保即使從舊版 oracle 啟動也會執行最新 setup
- 優先使用本機 `codegraph` CLI（若已安裝）
- 若本機 CLI 不可用，改用 `npx @colbymchenry/codegraph`
- 若初始化失敗，不中斷 oracle 同步流程，後續查詢會自動回退

### 7. 檢查並建立環境變數配置檔

檢查 `.cursor/.env.local` 是否存在，若不存在則以 pantheon 的 `.env.example` 為模板建立。

### 8. 輸出結果

顯示同步結果摘要：

```
✅ 同步完成！

目錄結構：
.cursor/
├── commands/
│   └── <install-name>/
├── rules/
│   └── <install-name>/
├── scripts/
│   └── <install-name>/
├── skills/
│   └── <install-name>/
└── .env.local
.agents/
├── commands/
│   └── <install-name>/
├── scripts/
│   └── <install-name>/
└── skills/
    └── <install-name>/

可用的指令：
- commands/<install-name>/cr/
- commands/<install-name>/utilities/
- commands/<install-name>/agent-operator/
```

## 使用範例

**範例 1: 首次設置專案**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon → 存在
2. 拉取 pantheon 當前分支最新內容
3. 建立 .cursor 與 .agents 安裝目錄
4. 複製安裝 Pantheon 內容
5. 更新 .gitignore
6. .env.local 不存在，建立模板檔案
7. 輸出結果，並提示用戶完善 .env.local 配置
```

**範例 2: 更新 pantheon 到最新版本**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon → 存在
2. 拉取 pantheon 當前分支最新內容 → 已更新
3. 目錄已存在，跳過建立
4. 重建 Pantheon 安裝內容
5. .gitignore 已包含 Pantheon 安裝產物
6. .env.local 已存在，跳過建立
7. 輸出結果
```

**範例 3: pantheon 已是最新版本**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon → 存在
2. 拉取 pantheon 當前分支最新內容 → 已是最新版本
3. 重建 Pantheon 安裝內容
4. 更新或確認 .gitignore
5. 輸出結果
```

## 注意事項

- ⚠️ 此指令需要專案已經包含 `.pantheon` 資料夾（透過 `pantheon:descend` 安裝）
- ⚠️ `.cursor/*/<install-name>` 與 `.agents/*/<install-name>` 是可重建安裝產物，不應手動修改
- ✅ 此指令可重複執行，會自動更新 pantheon 到最新版本
- ✅ 不會影響 `.cursor` 或 `.agents` 目錄中的其他檔案（如專案特有的腳本）
- ✅ `.env.local` 只會在不存在時建立，不會覆蓋既有配置
- ✅ 會自動維護 `.gitignore`，包含 `.cursor/.env.local`、`.cursor/*/<install-name>/` 與 `.agents/*/<install-name>/` 這類 Pantheon 本地安裝路徑
- ⚠️ 首次設置後請務必編輯 `.cursor/.env.local` 填入實際配置值
- ✅ pantheon 根據用戶初始化時設置的分支進行更新

## 腳本位置

腳本檔案位於：`.cursor/scripts/utilities/oracle.mjs`

當 pantheon 掛載到目標專案時，實際路徑為：`.pantheon/.cursor/scripts/utilities/oracle.mjs`

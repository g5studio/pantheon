---
description: 將 pantheon 的 .cursor 內容同步到專案中，自動建立符號連結
---

# Oracle - Pantheon Cursor 同步指令

此指令會自動將 `.pantheon/.cursor` 的內容透過符號連結同步到專案的 `.cursor` 目錄中，並拉取用戶初始化時設置的分支最新內容。

## 執行方式

當用戶輸入 `oracle` 時，AI 執行以下腳本：

```bash
node .pantheon/.cursor/scripts/utilities/oracle.mjs
```

> **注意**：此腳本需要在專案根目錄執行，且專案必須包含 `.pantheon` 資料夾（透過 `pantheon:descend` 安裝）。

### 🚨 權限要求

**CRITICAL**: 由於此腳本需要執行 `git fetch` 和 `git pull` 操作來同步遠端內容，AI **必須**使用 `required_permissions: ["network"]` 來執行此腳本。

```
run_terminal_cmd with required_permissions: ["network"]
```

如果未使用正確權限，腳本將無法連接到遠端 Git 倉庫，導致版本無法正確更新。

## 執行流程

腳本會依序執行以下步驟：

### 1. 檢查 .pantheon 是否存在

如果 `.pantheon/.cursor` 不存在，提示用戶執行 `npm run pantheon:descend` 安裝 Pantheon 並結束流程。

### 2. 拉取 pantheon 當前分支最新內容

- 取得 pantheon 當前分支（用戶初始化時透過 `--deities` 設置的分支）
- 若有本地變更，自動重置
- 執行 `git fetch` 和 `git pull` 拉取最新內容

### 3. 建立 .cursor 目錄結構

建立以下目錄（如果不存在）：
- `.cursor/commands/`
- `.cursor/rules/`
- `.cursor/scripts/`

### 4. 建立 prometheus 符號連結

在每個目錄中建立 `prometheus` 符號連結，指向 `.pantheon/.cursor` 對應的目錄：
- `.cursor/commands/prometheus` -> `../../.pantheon/.cursor/commands`
- `.cursor/rules/prometheus` -> `../../.pantheon/.cursor/rules`
- `.cursor/scripts/prometheus` -> `../../.pantheon/.cursor/scripts`

### 5. 檢查並建立環境變數配置檔

檢查 `.cursor/.env.local` 是否存在，若不存在則以 pantheon 的 `.env.example` 為模板建立。

### 6. 輸出結果

顯示同步結果摘要：

```
✅ 同步完成！

目錄結構：
.cursor/
├── commands/
│   └── prometheus/ -> .pantheon/.cursor/commands
├── rules/
│   └── prometheus/ -> .pantheon/.cursor/rules
├── scripts/
│   └── prometheus/ -> .pantheon/.cursor/scripts
└── .env.local

可用的指令：
- commands/prometheus/cr/
- commands/prometheus/utilities/
- commands/prometheus/agent-operator/
```

## 使用範例

**範例 1: 首次設置專案**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon → 存在
2. 拉取 pantheon 當前分支 (prometheus) 最新內容
3. 建立 .cursor/commands, .cursor/rules, .cursor/scripts 目錄
4. 建立 prometheus 符號連結
5. .env.local 不存在，建立模板檔案
6. 輸出結果，並提示用戶完善 .env.local 配置
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
4. 移除舊的符號連結，建立新的
5. .env.local 已存在，跳過建立
6. 輸出結果
```

**範例 3: pantheon 已是最新版本**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon → 存在
2. 拉取 pantheon 當前分支最新內容 → 已是最新版本
3. 重新建立符號連結
4. 輸出結果
```

## 注意事項

- ⚠️ 此指令需要專案已經包含 `.pantheon` 資料夾（透過 `pantheon:descend` 安裝）
- ⚠️ 如果 `.cursor/commands/prometheus` 等已存在且不是符號連結，請先手動移除
- ✅ 此指令可重複執行，會自動更新 pantheon 到最新版本
- ✅ 不會影響 `.cursor` 目錄中的其他檔案（如專案特有的腳本）

### 環境變數相關
- ✅ `.env.local` 只會在不存在時建立，不會覆蓋既有配置
- ⚠️ 首次設置後請務必編輯 `.cursor/.env.local` 填入實際配置值
- ✅ pantheon 根據用戶初始化時設置的分支進行更新

## 腳本位置

腳本檔案位於：`.cursor/scripts/utilities/oracle.mjs`

當 pantheon 掛載到目標專案時，實際路徑為：`.pantheon/.cursor/scripts/utilities/oracle.mjs`

---
description: 將 pantheon 的 .cursor 內容同步到專案中，自動建立符號連結
---

# Oracle - Pantheon Cursor 同步指令

此指令會自動將 `.pantheon/.cursor` 的內容透過符號連結同步到專案的 `.cursor` 目錄中。

## 執行方式

當用戶輸入 `oracle` 時，AI 執行以下腳本：

```bash
node .pantheon/.cursor/scripts/utilities/oracle.mjs
```

> **注意**：此腳本需要在專案根目錄執行，且專案必須包含 `.pantheon` submodule。

### 🚨 權限要求

**CRITICAL**: 由於此腳本需要執行 `git fetch` 和 `git pull` 操作來同步遠端內容，AI **必須**使用 `required_permissions: ["network"]` 來執行此腳本。

```
run_terminal_cmd with required_permissions: ["network"]
```

如果未使用正確權限，腳本將無法連接到遠端 Git 倉庫，導致版本無法正確更新。

## 執行流程

腳本會依序執行以下步驟：

### 1. 檢查 .pantheon submodule 是否存在

如果 `.pantheon/.cursor` 不存在，提示用戶執行 `git submodule update --init` 並結束流程。

### 2. 檢查主專案分支狀態（僅非首次設置時）

**CRITICAL**: 只有在已建立過連結（非首次設置）時才執行此步驟。

- 檢查主專案當前是否在 main branch
- 記錄分支狀態，用於決定步驟 3 的同步策略

### 3. 同步 pantheon 內容（僅非首次設置時）

根據主專案分支狀態採取不同的同步策略：

**若主專案在 main branch 上**：
- 拉取 pantheon 最新內容（`git fetch origin && git pull origin {branch}`）
- 確保 pantheon 保持最新版本

**若主專案不在 main branch 上**（如 feature branch）：
- 查詢 `origin/main` 中 `.pantheon` submodule 所指向的 commit hash
- 將 `.pantheon` checkout 到該特定版本
- **這確保 feature branch 使用的 pantheon 版本與 main 一致，避免 MR 出現預期外的 pantheon 變更**

### 4. 建立 .cursor 目錄結構

建立以下目錄（如果不存在）：
- `.cursor/commands/`
- `.cursor/rules/`
- `.cursor/scripts/`

### 5. 建立 prometheus 符號連結

在每個目錄中建立 `prometheus` 符號連結，指向 `.pantheon/.cursor` 對應的目錄：
- `.cursor/commands/prometheus` -> `../../.pantheon/.cursor/commands`
- `.cursor/rules/prometheus` -> `../../.pantheon/.cursor/rules`
- `.cursor/scripts/prometheus` -> `../../.pantheon/.cursor/scripts`

### 6. 檢查並建立環境變數配置檔

檢查 `.cursor/.env.local` 是否存在，若不存在則以 pantheon 的 `.env.example` 為模板建立。

### 7. 輸出結果

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
1. 檢查 .pantheon submodule → 存在
2. 未偵測到既有連結，跳過主專案同步與 pantheon 拉取
3. 建立 .cursor/commands, .cursor/rules, .cursor/scripts 目錄
4. 建立 prometheus 符號連結
5. .env.local 不存在，建立模板檔案
6. 輸出結果，並提示用戶完善 .env.local 配置
```

**範例 2: 重新同步（主專案已在 main 上）**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon submodule → 存在
2. 檢查主專案分支 → main
3. 拉取 pantheon 最新內容
4. 目錄已存在，跳過建立
5. 移除舊的符號連結，建立新的
6. .env.local 已存在，跳過建立
7. 輸出結果
```

**範例 3: 重新同步（主專案在 feature branch 上）**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon submodule → 存在
2. 檢查主專案分支 → feature/FE-1234（非 main）
3. 同步 pantheon 至主專案 main 分支所使用的版本
   - 查詢 origin/main 中 .pantheon 所指向的 commit: abc12345
   - 當前 pantheon commit: def67890
   - checkout 到 abc12345
4. 重新建立符號連結
5. 檢查 .env.local（已存在則跳過）
6. 輸出結果

✅ pantheon 已同步至 main 分支所使用的版本
   版本: abc12345
```

**範例 4: 重新同步（feature branch 上，pantheon 已與 main 同步）**
```
用戶: oracle

AI:
執行: node .pantheon/.cursor/scripts/utilities/oracle.mjs

輸出:
1. 檢查 .pantheon submodule → 存在
2. 檢查主專案分支 → feature/FE-5678（非 main）
3. 同步 pantheon 至主專案 main 分支所使用的版本
   - 查詢 origin/main 中 .pantheon 所指向的 commit: abc12345
   - 當前 pantheon commit: abc12345
   ✅ pantheon 已與 main 分支同步
4. 重新建立符號連結
5. 輸出結果
```

## 注意事項

### 權限相關
- 🚨 **AI 執行時必須使用 `required_permissions: ["network"]`**，否則無法執行 git 同步操作
- ⚠️ 若未正確設置權限，會導致版本無法正確更新

### Submodule 相關
- ⚠️ 此指令需要專案已經包含 `.pantheon` submodule
- ⚠️ 如果 `.cursor/commands/prometheus` 等已存在且不是符號連結，請先手動移除
- ✅ 此指令可重複執行，會自動更新符號連結
- ✅ 不會影響 `.cursor` 目錄中的其他檔案（如專案特有的腳本）

### 環境變數相關
- ✅ `.env.local` 只會在不存在時建立，不會覆蓋既有配置
- ⚠️ 首次設置後請務必編輯 `.cursor/.env.local` 填入實際配置值

### 分支同步相關
- ⚠️ **更新 pantheon 前會先檢查主專案是否在 main 上**
- ✅ 若主專案在 main 上：拉取 pantheon 最新版本
- ✅ 若主專案不在 main 上（如 feature branch）：同步到 main 所使用的 pantheon 版本
- ✅ **這確保 feature branch 不會意外更新到比 main 更新的 pantheon 版本，避免 MR 出現預期外的變更**

## 腳本位置

腳本檔案位於：`.cursor/scripts/utilities/oracle.mjs`

當 pantheon 作為 submodule 掛載時，實際路徑為：`.pantheon/.cursor/scripts/utilities/oracle.mjs`

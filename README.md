# Pantheon

## 專案宗旨

Pantheon 專案旨在規範開發流程中所有 Agent Operator 的行為與標準作業程序（SOP）。此專案作為 Agent Operator 的核心規範庫，提供標準化的開發守則、腳本與命令，以便快速部署到其他專案中。

在 AI 大規模協作時代下，我們建立了一套由人類決策者與多個 AI Agent 組成的分層式開發工法。此專案確保所有 Agent Operator 在執行開發任務時，能夠遵循一致的規範與流程，從而提升開發效率與程式碼品質。

## 核心目標

- **標準化 Agent 行為**：制定統一的開發守則與作業規範，確保所有 Agent Operator 遵循相同的標準
- **快速部署能力**：提供可重用的腳本與命令，讓 Agent Operator 能夠快速部署到不同專案
- **流程規範化**：從開發策略到 MR 程序的完整標準化流程
- **品質保證**：透過規範化的流程確保程式碼品質與一致性

## 相關資源

### 開發規範文件

- **[Agent Operator Guideline](https://innotech.atlassian.net/wiki/spaces/Frontend/pages/4078010378/Agent+Operator+Guideline)**：詳細說明新時代多層級 AI 協作開發模式，包含 Commander、Pilot、Operator、Master Controller、Reviewer、Admin 等角色的職責與工作流程

### 相關 Jira Tickets

- **[FE-7892](https://innotech.atlassian.net/browse/FE-7892)**：[AI] 抽出基礎 agent operator script & command 以便快速部署到其他專案
- **[FE-7893](https://innotech.atlassian.net/browse/FE-7893)**：[AI] 制定 agent operator 作業規範與開發守則

## 專案結構

本專案包含以下核心組件：

- **開發守則**：定義 Agent Operator 在開發過程中的行為規範
- **代碼提交守則**：規範 commit 與 MR 建立的標準流程
- **腳本與命令**：可重用的工具腳本，支援快速部署到其他專案
- **規範文件**：完整的 SOP 文件，供 Agent Master Controller 作為檢視標準

## 安裝方式

### 1. 添加腳本到目標專案

在目標專案的 `package.json` 中添加以下腳本：

```json
{
  "scripts": {
    "pantheon:descend": "BRANCH=${npm_config_deities:-prometheus} && git submodule add -b \"$BRANCH\" git@gitlab.service-hub.tech:frontend/pantheon.git .pantheon && mkdir -p .cursor/commands .cursor/rules .cursor/scripts && ln -sf ../../.pantheon/.cursor/commands .cursor/commands/prometheus && ln -sf ../../.pantheon/.cursor/rules .cursor/rules/prometheus && ln -sf ../../.pantheon/.cursor/scripts .cursor/scripts/prometheus && echo \"✅ Pantheon mounted on branch: $BRANCH\"",
    "pantheon:oracle": "git submodule update --init --remote .pantheon"
  }
}
```

### 2. 執行安裝

```bash
# 使用預設模型 (prometheus) 安裝
npm run pantheon:descend

# 或指定其他模型安裝
npm run pantheon:descend --deities=athena
```

### 3. 更新 Pantheon

```bash
npm run pantheon:oracle
```

### 腳本說明

| 腳本 | 功能 |
|---|---|
| `pantheon:descend` | 初始化 Pantheon submodule 並建立 symbolic links |
| `pantheon:oracle` | 更新 Pantheon submodule 到最新版本 |

## Submodule 使用說明

Pantheon 專案設計為可以作為 **git submodule** 掛載到其他專案中，並透過 **symbolic link** 進行同步。

### 掛載後的路徑結構

當 Pantheon 掛載到目標專案時，所有檔案會位於 `.pantheon/` 資料夾下：

```
目標專案/
├── .pantheon/                    # Pantheon submodule 掛載點
│   └── .cursor/
│       ├── commands/             # 命令檔案
│       ├── rules/                # 規則檔案
│       ├── scripts/              # 腳本檔案
│       └── version.json          # 版本資訊
├── .cursor/                      # 專案自有的 Cursor 設定（可選）
└── ...
```

### 路徑對應範例

| Pantheon 內部路徑 | 掛載後實際路徑 |
|---|---|
| `.cursor/scripts/cr/agent-commit.mjs` | `.pantheon/.cursor/scripts/cr/agent-commit.mjs` |
| `.cursor/scripts/notification/notify-cursor-rules-failed.mjs` | `.pantheon/.cursor/scripts/notification/notify-cursor-rules-failed.mjs` |
| `.cursor/rules/*.mdc` | `.pantheon/.cursor/rules/*.mdc` |
| `.cursor/commands/*.md` | `.pantheon/.cursor/commands/*.md` |

### AI 執行腳本注意事項

**重要**：當 AI 在目標專案中執行 Pantheon 提供的腳本時，必須使用正確的路徑：

1. **先檢查 `.pantheon/` 資料夾是否存在**
2. 如果存在，使用 `.pantheon/.cursor/scripts/...` 路徑
3. 如果不存在（在 Pantheon 專案本身），使用 `.cursor/scripts/...` 路徑

詳細的路徑規則請參考：`.cursor/rules/submodule-path-guideline.mdc`

## 開發模式

本專案遵循「新時代多層級 AI 協作開發模式」，將開發流程拆分為六大關卡：

1. **任務規劃**：Commander 解讀需求並產出任務簡報
2. **計畫推導**：Pilot 轉化任務簡報為執行計畫
3. **自主開發**：Operator 依照執行計畫完成實質開發
4. **稽核**：Master Controller 檢查開發流程是否符合規範
5. **審核**：Code Reviewer 審核程式碼品質與風險
6. **管控**：Admin 監控整體流程運作

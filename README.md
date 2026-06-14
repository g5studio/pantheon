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

在目標專案的 `package.json` 中添加以下腳本（跨平台支援 Windows / macOS / Linux）：

```json
{
  "scripts": {
    "pantheon:descend": "node -e \"const b=process.env.npm_config_deities||'prometheus';require('child_process').execSync('git clone -b '+b+' git@gitlab.service-hub.tech:frontend/pantheon.git .pantheon',{stdio:'inherit'});require('child_process').execSync('node .pantheon/.cursor/scripts/utilities/oracle.mjs',{stdio:'inherit'})\"",
    "pantheon:oracle": "node .pantheon/.cursor/scripts/utilities/oracle.mjs"
  }
}
```

### 2. 執行安裝

```bash
# 使用預設分支 (prometheus) 安裝
npm run pantheon:descend

# 或指定其他 Pantheon 分支安裝
npm run pantheon:descend --deities=athena
```

### 3. 更新 Pantheon

```bash
npm run pantheon:oracle
```

### 腳本說明

| 腳本 | 功能 | 平台支援 |
|---|---|---|
| `pantheon:descend` | 初始化 Pantheon 並複製安裝 tooling（透過 git clone） | Windows / macOS / Linux |
| `pantheon:oracle` | 更新 Pantheon 到最新版本，重建本地安裝內容，自動建立 `.env.local` | Windows / macOS / Linux |

### 執行效果

`pantheon:descend` 執行後會：
1. Clone Pantheon 到 `.pantheon/` 目錄
2. 將 Pantheon 的 `commands`、`scripts`、`skills` 複製安裝到 `.cursor/*/{deities}/` 與 `.agents/*/{deities}/` 下
3. 將 `.cursor/rules/{deities}/` 安裝到目標專案，保留 Cursor 規則能力
4. 自動將 `.pantheon/`、`.cursor/.env.local`、`.cursor/.../{deities}/`、`.agents/.../{deities}/` 加入目標專案 `.gitignore`
5. 自動建立 `.cursor/.env.local` 環境變數配置檔（從模板）

`pantheon:oracle` 執行後會：
1. 拉取 Pantheon 最新內容
2. 重建 `.cursor` 與 `.agents` 下的 Pantheon 安裝內容
3. 更新或確認 `.gitignore`
4. 檢查並建立 `.env.local`（如不存在）

## 掛載使用說明

Pantheon 專案設計為可以透過 **git clone** 掛載到其他專案中，並透過 `oracle` 將 tooling 內容複製安裝到目標專案。RD 自行初始化後可透過 `pantheon:oracle` 指令更新版本。

### 掛載後的路徑結構

當 Pantheon 掛載到目標專案時，所有檔案會位於 `.pantheon/` 資料夾下：

```
目標專案/
├── .pantheon/                    # Pantheon 掛載點（透過 git clone）
│   └── .cursor/
│       ├── commands/             # 命令檔案
│       ├── rules/                # 規則檔案
│       ├── scripts/              # 腳本檔案
│       ├── skills/               # Skills 檔案
│       └── version.json          # 版本資訊
├── .cursor/                      # Cursor 本地安裝內容與專案自有設定
│   ├── commands/{deities}/
│   ├── rules/{deities}/
│   ├── scripts/{deities}/
│   └── skills/{deities}/
├── .agents/                      # Agent 本地安裝內容
│   ├── commands/{deities}/
│   ├── scripts/{deities}/
│   └── skills/{deities}/
└── ...
```

### 路徑對應範例

| Pantheon 來源路徑 | 本地安裝路徑 |
|---|---|
| `.pantheon/.cursor/scripts/cr/agent-commit.mjs` | `.cursor/scripts/{deities}/cr/agent-commit.mjs`、`.agents/scripts/{deities}/cr/agent-commit.mjs` |
| `.pantheon/.cursor/scripts/notification/notify-cursor-rules-failed.mjs` | `.cursor/scripts/{deities}/notification/notify-cursor-rules-failed.mjs`、`.agents/scripts/{deities}/notification/notify-cursor-rules-failed.mjs` |
| `.pantheon/.cursor/rules/*.mdc` | `.cursor/rules/{deities}/*.mdc` |
| `.pantheon/.cursor/commands/*.md` | `.cursor/commands/{deities}/*.md`、`.agents/commands/{deities}/*.md` |
| `.pantheon/.cursor/skills/*/SKILL.md` | `.cursor/skills/{deities}/*/SKILL.md`、`.agents/skills/{deities}/*/SKILL.md` |

### AI 執行腳本注意事項

**重要**：當 AI 在目標專案中執行 Pantheon 提供的腳本時，必須使用正確的路徑：

1. **先檢查 `.pantheon/` 資料夾是否存在**
2. 如果存在，使用 `.pantheon/.cursor/scripts/...` 路徑
3. 如果不存在（在 Pantheon 專案本身），使用 `.cursor/scripts/...` 路徑

詳細的路徑規則請參考：`.cursor/rules/pantheon-path-guideline.mdc`

## Repo 知識庫與生態演化

| 指令 | 用途 | 產物 |
|---|---|---|
| `adapt` | 解析並記錄專案特性（git flow、coding standard、label rule） | `adapt.json`、pantheon-mounted-workflow skill |
| `analyze-project-schema` | 以 LLM 分析專案模塊架構（預設 gpt-5.3-codex） | `project-schema.json`、`architecture-preview.md` |
| `evolve` | 將專案改造成適合 Operator Agent 操作的生態 | 在目標專案產生 `project-schema` skill、`misnamed-file-report.md`、註解補全 |

`evolve` 需在 `adapt` 完成後於**目標專案**執行；階段一透過 `analyze-project-schema` 生成 `project-schema.json`，`architecture-preview.md` 等產物寫入目標專案根目錄，不在 Pantheon repo 內。詳見 `.cursor/commands/utilities/adapt.md`、`.cursor/commands/utilities/analyze-project-schema.md` 與 `.cursor/commands/utilities/evolve.md`。

## 開發模式

本專案遵循「新時代多層級 AI 協作開發模式」，將開發流程拆分為六大關卡：

1. **任務規劃**：Commander 解讀需求並產出任務簡報
2. **計畫推導**：Pilot 轉化任務簡報為執行計畫
3. **自主開發**：Operator 依照執行計畫完成實質開發
4. **稽核**：Master Controller 檢查開發流程是否符合規範
5. **審核**：Code Reviewer 審核程式碼品質與風險
6. **管控**：Admin 監控整體流程運作

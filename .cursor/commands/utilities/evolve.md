---
description: 將專案改造成適合 Operator Agent 操作的生態（模塊架構、註解補全、命名校正）
---

## evolve - Operator Agent 生態演化

此指令在 `adapt` 完成 repo 知識庫落地化之後執行，目標是將專案改造成適合 Operator Agent 操作的生態。

**前置條件**：專案根目錄必須已有 `adapt.json`（含 `coding-standard`、`git-flow`、`labels` 等區塊）。若尚未執行，請先跑 `adapt`。

**適合 Operator Agent 的生態特徵**：

1. 專案內容有足夠註解與說明，協助不同 LLM 分析專案時不會因 model 等級而有太大結果落差
2. 檔案命名與實際用途相符，且開發方式符合標準程式設計流程與專案自身的 coding standard / project coding style

**落地產物**：

| 產物 | 路徑 | 說明 |
|---|---|---|
| 模塊架構 skill | `.cursor/skills/project-schema/SKILL.md` | 記錄專案模塊分工，供後續 Operator 運作參考 |
| 命名報告 | `misnamed-file-report.md`（專案根目錄） | 彙整命名不符檔案與推薦名稱 |

---

## 0) 前置檢查

當用戶輸入 `evolve` 時，AI **必須**先確認 `adapt.json` 存在且可讀：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs check-prereq
```

若在 Pantheon repo 本身：

```bash
pnpm run evolve -- check-prereq
```

若 `adapt.json` 不存在或過舊，**停止 evolve 流程**，提示用戶先執行 `adapt`。

讀取 `adapt.json` 時，至少參考：

- `coding-standard`：註解格式、命名慣例、目錄結構規則
- `git-flow`：分支命名、commit 格式、工單號模式
- `labels`：模塊/功能領域標籤（輔助同質性分類）

---

## 1) 階段一：模塊架構分析與 project-schema 落地

### 1.1 閱讀專案並分析模塊

AI 應系統性閱讀專案原始碼與設定檔，依**同質性**（職責、依賴方向、目錄慣例、命名前綴）分析模塊架構。

輔助列出可分析檔案：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs list-files
```

可選參數：

```bash
# 限制目錄
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs list-files -- --dirs="src,.cursor"

# 輸出 JSON
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs list-files -- --format=json
```

### 1.2 在 chat 呈現架構圖並與用戶確認

**必須**在 chat 輸出以下內容，並使用 **Answer 選項視窗**等待用戶確認：

#### 結構總覽表

| 模塊 | 路徑範圍 | 職責 | 主要依賴 |
|---|---|---|---|
| （依分析填寫） | | | |

#### 模塊定義表

| 模塊 ID | 顯示名稱 | 邊界定義 | 不應包含 |
|---|---|---|---|
| （依分析填寫） | | | |

#### Mermaid 架構圖

```mermaid
flowchart TD
  A[入口層] --> B[業務模塊]
  B --> C[共用工具]
```

#### 確認選項

- **選項 A**：架構正確，進入階段二
- **選項 B**：需調整（請用戶補充修正意見）
- **選項 C**：取消 evolve 流程

### 1.3 生成 project-schema skill

用戶確認後，AI 組裝 schema JSON 並落地 skill：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs write-schema -- --input-file="./.evolve-tmp/project-schema.json"
```

`project-schema.json` 結構：

```json
{
  "projectName": "專案名稱",
  "summary": "1-3 句專案摘要",
  "modules": [
    {
      "id": "module-id",
      "name": "模塊顯示名稱",
      "paths": ["src/modules/foo"],
      "responsibility": "模塊職責說明",
      "boundaries": "邊界定義：不應包含的內容",
      "dependencies": ["other-module-id"]
    }
  ],
  "entryPoints": ["src/index.ts"],
  "conventions": {
    "naming": "命名慣例摘要（來自 adapt.json coding-standard）",
    "commentStyle": "註解風格摘要"
  }
}
```

落地路徑（腳本會同步多處）：

- `.cursor/skills/project-schema/SKILL.md`
- `.agents/skills/project-schema/SKILL.md`（若存在 `.agent/` 也會同步）

---

## 2) 階段二：逐檔分析、註解補全與命名檢查

依 `project-schema` 的模塊定義，**逐模塊、逐檔案**執行以下檢查。

### 2.1 命名與用途核對原則

**預設假設**：原始檔案命名可能有問題。核對方式：

1. 閱讀檔案內容，判斷實際用途
2. 查閱該檔案 git history 的 commit message
3. 若 commit message 含工單號（如 `FE-1234`、`IN-5678`、`AI-320`），連帶查詢 Jira ticket

查詢單檔 git history：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs file-history -- --path="src/foo/bar.ts" --max=30
```

查詢 Jira（有工單號時）：

```bash
pnpm run read-jira-ticket -- --ticket=FE-1234
```

### 2.2 註解補全規則

完成單檔分析後，依專案 `coding-standard` 補充註解：

| 目標 | 要求 |
|---|---|
| 檔案頂部 | 在檔案最上方添加區塊註解，描述檔案用途、所屬模塊、關聯工單（若有） |
| 函式 | 說明用途、參數、回傳值；有工單則標註 |
| 物件 / 常數 | 說明用途與使用情境；有工單則標註 |
| 既有 skill 格式 | 若專案已有註解/skill 規範，**先**依專案格式，再在下方補檔案用途 |

**工單註解格式範例**（依專案慣例調整）：

```javascript
/**
 * @ticket FE-1234 - 修正 XXX 流程
 * @purpose 處理 YYY 情境的資料轉換
 */
```

```typescript
// [FE-1234] 使用者權限檢查：驗證 token 有效性
```

**禁止行為**：

- ❌ 未經用戶同意直接大量修改原始碼（階段二屬於「建議 + 待用戶確認後套用」；若用戶明確授權可批次套用）
- ❌ 註解與實際邏輯不符
- ❌ 刪除既有有效註解

### 2.3 單檔完成標記

每完成一檔分析，在內部追蹤表記錄：

| 欄位 | 說明 |
|---|---|
| `module` | 所屬模塊 ID |
| `path` | 檔案路徑 |
| `actualPurpose` | 實際用途 |
| `nameMatchesPurpose` | 命名是否相符 |
| `recommendedName` | 推薦名稱（若不符） |
| `tickets` | 關聯工單號陣列 |
| `commentsAdded` | 是否已補註解 |

建議將追蹤資料寫入 `.evolve-tmp/analysis-progress.json`（此目錄應加入 `.gitignore`）。

---

## 3) 階段三：命名報告與重新命名確認

全部檔案檢查完成後：

### 3.1 在 chat 呈現彙整表

| 模塊 | 原檔案名稱 | 實際用途 | 推薦名稱 |
|---|---|---|---|
| `module-id` | `old-name.ts` | 實際做什麼 | `new-name.ts` |

僅列出 `nameMatchesPurpose === false` 的項目；若無則明確告知「未發現命名問題」。

### 3.2 生成 misnamed-file-report

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs write-report -- --input-file="./.evolve-tmp/analysis-progress.json"
```

輸出：專案根目錄 `misnamed-file-report.md`

### 3.3 詢問是否代理執行重新命名

使用 **Answer 選項視窗**：

- **選項 A**：代理執行全部重新命名（含更新 import 路徑）
- **選項 B**：僅執行部分（請用戶指定模塊或檔案）
- **選項 C**：不執行重新命名，僅保留報告
- **選項 D**：取消

若用戶選擇執行重新命名，先 dry-run：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs rename -- --input-file="./.evolve-tmp/rename-plan.json" --dry-run
```

確認無誤後執行：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs rename -- --input-file="./.evolve-tmp/rename-plan.json"
```

`rename-plan.json` 結構：

```json
{
  "renames": [
    { "from": "src/old-name.ts", "to": "src/new-name.ts" }
  ]
}
```

**重新命名注意事項**：

- 使用 `git mv` 保留 history
- 同步更新所有 import / require 路徑
- 重新命名後執行專案 lint / typecheck（若存在）
- **不**自動 commit；詢問用戶是否要 commit

---

## 4) 與 adapt 的協作關係

```mermaid
flowchart LR
  A[adapt] --> B[adapt.json]
  B --> C[evolve 階段一]
  C --> D[project-schema skill]
  D --> E[evolve 階段二]
  E --> F[註解補全 + 命名檢查]
  F --> G[evolve 階段三]
  G --> H[misnamed-file-report.md]
  H --> I{用戶確認}
  I -->|是| J[重新命名]
  I -->|否| K[保留報告]
```

| 步驟 | 指令 | 產物 |
|---|---|---|
| 1 | `adapt` | `adapt.json`、pantheon-mounted-workflow skill |
| 2 | `evolve`（本指令） | `project-schema` skill、`misnamed-file-report.md`、註解補全 |

---

## 5) 執行策略與 token 管理

大型專案建議分批處理：

1. **按模塊分批**：每次處理一個模塊，完成後向用戶報告進度
2. **暫存進度**：使用 `.evolve-tmp/` 保存分析狀態，支援中斷後續跑
3. **優先順序**：入口檔 → 核心業務 → 工具函式 → 設定檔

恢復未完成的 evolve：

```bash
node .cursor/scripts/utilities/run-pantheon-script.mjs utilities/evolve.mjs status
```

---

## 6) 環境依賴

| 功能 | 依賴 |
|---|---|
| 基礎分析 | 本地 git、專案原始碼 |
| repo 知識 | `adapt.json`（需先執行 `adapt`） |
| Jira 工單查詢 | `read-jira-ticket`（`JIRA_EMAIL` + `JIRA_API_TOKEN`） |
| 重新命名 | git、專案 linter（可選） |

---

## 7) 禁止行為摘要

- ❌ 未執行 `adapt` 就開始 `evolve`
- ❌ 未經用戶確認架構就生成 `project-schema`
- ❌ 未經用戶確認就執行大量重新命名
- ❌ 註解內容與實際程式邏輯不一致
- ❌ 覆蓋用戶自訂且非 `managed-by-pantheon-evolve` 標記的 `project-schema` skill

## 📋 關聯單資訊

| 項目 | 值 |
|---|---|
| **單號** | [FE-8291](https://innotech.atlassian.net/browse/FE-8291) |
| **標題** | [AI] 新增 evolve 演化指令，將專案改造成 Operator Agent 操作生態 |
| **類型** | Request |
| **關聯 Epic** | [FE-7840](https://innotech.atlassian.net/browse/FE-7840) |

---

## 📝 變更摘要

在 `adapt` 完成 repo 知識庫落地化之後，新增 `evolve` 演化指令與輔助腳本，協助將目標專案改造成適合 Operator Agent 操作的生態。包含三階段流程（模塊架構分析、逐檔註解與命名檢查、命名報告與重新命名確認），並落地 `project-schema` skill 與 `misnamed-file-report.md` 產物。

### 變更內容

| 檔案 | 狀態 | 說明 |
|---|---|---|
| `.cursor/commands/utilities/evolve.md` | 新增 | evolve 指令三階段 SOP 文件 |
| `.cursor/scripts/utilities/evolve.mjs` | 新增 | 輔助腳本（check-prereq、list-files、file-history、write-schema、write-report、rename） |
| `.cursor/skills/project-schema/SKILL.md` | 新增 | 模塊架構 skill 佔位模板 |
| `.cursor/commands/utilities/adapt.md` | 更新 | 新增 adapt → evolve 後續流程說明 |
| `package.json` | 更新 | 新增 `evolve` script |
| `README.md` | 更新 | 新增 adapt / evolve 對照表 |

---

## ⚠️ 風險評估

| 檔案 | 風險等級 | 評估說明 |
|---|---|---|
| `.cursor/scripts/utilities/evolve.mjs` | 中度 | 新增腳本含 `git mv` 重新命名與 import 字串替換邏輯；僅在用戶明確確認後執行，且支援 `--dry-run`，不影響既有 adapt/cr 流程 |
| `.cursor/commands/utilities/evolve.md` | 輕度 | 純新增指令文件，不修改既有行為 |
| `.cursor/skills/project-schema/SKILL.md` | 輕度 | 佔位模板，帶 `managed-by-pantheon-evolve` 標記避免覆蓋自訂內容 |
| `.cursor/commands/utilities/adapt.md` | 輕度 | 僅追加交叉引用段落 |
| `package.json` | 輕度 | 新增獨立 script entry，不影響既有 scripts |
| `README.md` | 輕度 | 文檔更新，無執行邏輯變更 |

### 預期效果

1. Operator 可在 `adapt` 後執行 `evolve`，系統性分析專案模塊並生成 `project-schema` skill
2. 透過 git history + Jira 工單追溯，補全檔案與宣告註解
3. 產出 `misnamed-file-report.md`，協助命名校正決策
4. 降低不同 LLM 等級分析同一專案時的結果落差

### 需求覆蓋率

| 需求項目 | 狀態 |
|---|---|
| 三階段 evolve 指令流程 | ✅ 已實作（evolve.md） |
| adapt.json 前置依賴檢查 | ✅ 已實作（check-prereq） |
| project-schema skill 落地 | ✅ 已實作（write-schema） |
| git history 工單追溯 | ✅ 已實作（file-history） |
| misnamed-file-report 生成 | ✅ 已實作（write-report） |
| 重新命名代理執行（含 dry-run） | ✅ 已實作（rename） |
| adapt 後續流程交叉引用 | ✅ 已實作 |

### 潛在影響風險報告

- `rename` 子命令使用字串替換更新 import，複雜 alias 路徑可能需要人工複查
- 大型專案 evolve 階段二可能耗時較長，建議按模塊分批並使用 `.evolve-tmp/` 暫存進度
- 不影響既有 `adapt`、`cr`、`oracle` 等指令的執行邏輯

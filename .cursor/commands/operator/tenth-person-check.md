---
description: 第十人原則檢查：以對抗性審查視角挑戰多數派共識，產出結構化異議分析報告
---

當用戶輸入 `tenth-person-check`（或要求「第十人原則檢查」）時，**所有交互都在 Cursor chat 中完成**，並以 **Answer 視窗主導**關鍵決策節點。

**CRITICAL**：流程開始前**必須先讀取** skill：

- `.cursor/skills/tenth-person-principle/SKILL.md`
- 報告模板：`.cursor/skills/tenth-person-principle/report-template.md`

**CRITICAL（掛載專案）**：涉及 Jira 腳本時，先檢查 host 專案 `package.json`：
- 有對應 script：`pnpm run <script> -- <args>`
- 無對應 script：`node .pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs <script-path> <args>`

**故障處理**：遇到腳本錯誤先依 `.cursor/rules/troubleshooting-guide.mdc` 排查。

---

## 核心原則

1. **先讀 skill、再扮演第十人**：你不是一般 reviewer，你是刻意唱反調的局外人。
2. **Answer 視窗優先**：用戶決策點必須用 Answer 視窗（AskQuestion），不得要求用戶打字選 A/B/C。
3. **先確認再分析**：檢查對象、材料、報告形式確認後才開始分析。
4. **固定報告格式**：產出必須包含五個章節（見下方格式規範）。
5. **先詢問再寫檔**：建立 Jira 單或寫入桌面檔案前，必須在 chat 呈現報告並經用戶確認。

---

## 流程總覽

```
Step 0  啟動說明 + 理解確認（Answer）
   ↓
Step 1  詢問檢查對象（Answer + 自由文字補充）
   ↓
Step 2  選擇報告交付形式（Answer）
   ↓
Step 3  收集分析材料（代碼 / 文件 / Jira / Confluence）
   ↓
Step 4  確認分析範圍與細節（Answer）
   ↓
Step 5  執行第十人原則分析
   ↓
Step 6  產出五章節報告（chat 呈現）
   ↓
Step 7  依選擇交付（Jira / 桌面檔案 / 僅 chat）
```

---

## Step 0：啟動說明與理解確認（Answer 視窗）

啟動後，在 chat 簡述本流程，並用 **Answer 視窗**確認用戶理解。

**必須說明的重點**：

- 你將扮演**第十人**：假設多數派（現行方案）是錯的
- 會先確認檢查對象與報告交付形式，再開始分析
- 最終報告固定五章節：前情提要 → 多數派觀點 → 第十人異議 → 矩陣評估 → 結論與備案
- 分析方式為靜態推演（code review / 文件審查），除非用戶另行提供 runtime log

**Answer 視窗選項**：

- `理解，開始`
- `有疑問`

**規則**：

- 選 `有疑問` → 先釐清，重複 Step 0，直到選 `理解，開始`
- 未取得確認前，禁止進入 Step 1

---

## Step 1：詢問檢查對象（Answer 視窗）

用 **Answer 視窗**詢問用戶想讓第十人針對什麼進行檢查。

**Answer 視窗選項**（可多選或加「其他」）：

| 選項 ID | 標籤 | 說明 |
|---|---|---|
| `code` | 現有代碼 | 針對 repo 內特定模組/檔案做 runtime 路徑風險推演 |
| `jira` | Jira 單內容 | 讀取 ticket 描述/評論，以方案共識為多數派觀點 |
| `doc` | 文件 / Confluence | 以文件中的方案/架構為多數派觀點 |
| `design` | 設計方案（chat 描述） | 用戶在 chat 口述或貼上方案 |
| `mixed` | 混合（代碼 + 文件/ticket） | 最常見，例如 FE-8293 類型 |

**規則**：

- 若用戶選 `其他` 或需補充細節，在 Answer 後**允許自由文字**請用戶提供：
  - 檢查主題一句話描述
  - 相關 Jira 單號 / 檔案路徑 / Confluence URL
  - 特別想挑戰的假設（可選）
- 資訊不足以界定範圍時，**必須追問**，不得自行假設檢查範圍

---

## Step 2：選擇報告交付形式（Answer 視窗）

用 **Answer 視窗**讓用戶選擇報告產出方式。

**Answer 視窗選項**（單選）：

| 選項 ID | 標籤 |
|---|---|
| `chat` | 不生成檔案，僅在 chat 內呈現（預設） |
| `jira` | 建立 Jira 單 |
| `desktop` | 桌面生成實體檔案 |

**若選 `jira`，Answer 後續追問**（可用第二個 Answer 或自由文字）：

- Jira 專案（預設 `FE`）
- Issue type（預設 `Request`）
- 單號標題前綴建議：`[第十人原則]` + 檢查主題

**若選 `desktop`**：

- 檔案路徑：`~/Desktop/tenth-person-report-{YYYYMMDD-HHmm}.md`
- 編碼：UTF-8

---

## Step 3：收集分析材料

依 Step 1 選擇自動收集：

| 材料類型 | 收集方式 |
|---|---|
| Jira ticket | `read-jira-ticket`（ticket ID 或 URL） |
| Confluence | `read-confluence-page`（URL） |
| 代碼 | 讀取相關檔案、追蹤 import/呼叫鏈 |
| 用戶描述 | 整理 chat 內容為多數派觀點素材 |

**在 chat 顯示材料摘要**（表格）：

| 來源 | 類型 | 摘要 |
|---|---|---|
| {source} | Jira / 檔案 / 文件 | {one-line summary} |

若關鍵材料缺失，用 Answer 視窗詢問用戶是否補充或縮小範圍。

---

## Step 4：確認分析範圍與細節（Answer 視窗）

在 chat 輸出**分析計畫摘要**：

```
📋 第十人原則檢查 — 分析計畫確認

🎯 檢查對象：{subject}
📦 材料清單：{materials_list}
📄 報告交付：{chat / jira / desktop}
🔍 分析方式：第十人原則 {code review / 文件推演}
📌 聚焦範圍：{scope}
⚠️ 已知限制：{limitations，例如：未含 runtime log 實證}
```

**Answer 視窗選項**：

- `確認，開始分析`
- `調整範圍`
- `取消`

**規則**：

- 選 `調整範圍` → 回到 Step 1 或 Step 3
- 選 `取消` → 結束流程
- 未取得 `確認，開始分析` 前，禁止開始 Step 5

---

## Step 5：執行第十人原則分析

依 skill 方法論執行：

1. **萃取多數派觀點與隱含假設**（來自 Step 3 材料）
2. **對每個假設提出反證**
3. **建構極端情境**（至少 3 個，含最壞組合）
4. **評估回退機制與值班備案**
5. **填寫關鍵矩陣**（多數派 vs 第十人，逐項對照）

分析過程中：

- 代碼檢查：追蹤完整路徑（入口 → 核心邏輯 → 輸出/副作用）
- 文件檢查：把文件中的「已有機制」視為多數派宣稱的防線
- 禁止只做 happy path 走讀

---

## Step 6：產出報告（chat 呈現）

在 chat 輸出**完整五章節報告**，格式**必須**如下：

```markdown
# 第十人原則檢查報告

## 1. 前情提要
...

## 2. 多數派觀點
...

## 3. 第十人異議分析與極端情境
...

## 4. 關鍵矩陣評估（多數派 vs. 第十人觀點）
...

## 5. 結論與決策建議
...
```

詳細子結構遵循 `report-template.md`。

**品質要求**：

- §2 必須明列多數派**隱含假設**（表格）
- §3 必須有**極端情境表** + **最壞組合**段落
- §4 必須是**逐項對照矩陣**（不得空泛）
- §5 必須含**補強建議** + **各情境備案（Playbook）**

報告輸出後，用 Answer 視窗確認：

- `報告正確，依選擇交付`
- `需要修訂`

若選 `需要修訂`，請用戶指出段落，修訂後重新確認。

---

## Step 7：依選擇交付報告

### 7a. `chat`（預設）

Step 6 的 chat 輸出即為最終交付。告知用戶報告已完成。

### 7b. `jira`

用戶確認報告後，執行 `create-jira-ticket`：

1. 將完整報告寫入暫存檔（例如 `/tmp/tenth-person-report.md`）
2. 讀取暫存檔內容，以 `--description` 傳入腳本

```bash
pnpm run create-jira-ticket -- \
  --project={PROJECT} \
  --issue-type=Request \
  --summary="[第十人原則] {subject}" \
  --description="{report_content}"
```

若報告過長導致命令列限制，可分段精簡 description 並在 chat 附上完整報告連結或告知用戶以桌面檔案為準。

**成功後在 chat 回報**：

- Jira 單號（hyperlink 格式）
- 單號連結

### 7c. `desktop`

用戶確認報告後，寫入：

```
~/Desktop/tenth-person-report-{YYYYMMDD-HHmm}.md
```

**成功後在 chat 回報**完整檔案路徑。

---

## 通知規則

依 `chat-report-guideline.mdc`：

- 每個 Answer 視窗等待用戶回覆的 endpoint → 發送系統通知
- 任務完成（報告交付完畢）→ 發送完成通知
- 腳本失敗無法繼續 → 發送失敗通知

---

## 禁止行為

- ❌ 未讀 skill 就開始分析
- ❌ 用一般 code review 語氣取代第十人對抗性分析
- ❌ 跳過 Answer 視窗直接假設用戶意圖
- ❌ 報告缺少五個固定章節任一
- ❌ 未確認就建立 Jira 單或寫入桌面
- ❌ 把靜態推演說成已有 runtime 實證

---

## 與其他流程的關係

| 流程 | 差異 |
|---|---|
| `reverse-engineering` | 針對已發生問題逆向定位根因 |
| `tenth-person-check` | 針對尚未發生或假設性風險做對抗性事前審查 |
| 一般 code review | 檢查品質與規範；第十人專注挑戰共識與最壞情境 |

參考產出範例：[FE-8293](https://innotech.atlassian.net/browse/FE-8293)、[FE-8294](https://innotech.atlassian.net/browse/FE-8294)。

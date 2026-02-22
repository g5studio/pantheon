---
description: 自動執行 commit 和建立 MR 的完整流程
---

<!-- cSpell:disable -->

## 簡化指令

**`cr multiple-ticket`** - 快速執行 commit 並建立 MR，**必須**提供多於一個 Jira ticket（預設送審，可用 `--no-review` 跳過）

**CRITICAL**: `cr multiple-ticket` 指令**必須**提供多於一個 Jira ticket（當前分支單號 + 至少一個關聯單號）。如果只有一個 ticket，請使用 `cr single-ticket` 指令。

當用戶輸入 `cr multiple-ticket` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. **驗證多 ticket 要求**（見下方「多 Ticket 驗證流程」）
3. 從上下文推斷 commit 信息（type, ticket, message）
4. 執行 commit 並推送到遠端
5. 自動建立 MR（包含 FE Board label、reviewer、draft 狀態、delete source branch）
6. **預設提交 AI review**（用戶可用 `--no-review` 明確跳過；若缺少 `COMPASS_API_TOKEN` 則會自動跳過 AI review；若為更新既有 MR，會由 `update-mr.mjs` 決定是否送審）

**多 Ticket 驗證流程：**

1. **用戶明確提供多個 ticket**：
   - 用戶輸入: `cr multiple-ticket 這個修改同時修復了 IN-1235 和 IN-1236`
   - → 驗證通過，繼續執行流程

2. **用戶語意暗示「主單與所有子任務」**：
   - 偵測關鍵字：「所有子任務」、「子項目」、「包含子任務」、「主單和子任務」、「all subtasks」、「with subtasks」等
   - → 自動詢問用戶確認
   - → 確認後透過 Jira API 讀取子任務：`node .cursor/scripts/jira/read-jira-ticket.mjs "<ticket-id>"`
   - → 從回傳 JSON 的 `raw.fields.subtasks` 提取子任務單號
   - → 自動設置為 `--related-tickets` 參數

3. **用戶只提供一個 ticket 且無子任務意圖**：
   - → 提示用戶選擇：提供關聯單號、自動獲取子任務、或改用 `cr single-ticket`

**參數支持：**
- `--reviewer="@username"`：指定 MR reviewer（**僅在用戶明確指定時使用**）
  - **Reviewer 優先順序**：
    1. 命令行參數（`--reviewer=`）：最高優先級，用戶明確指定
    2. 環境變數（`.env.local` 中的 `MR_REVIEWER`）：用戶偏好設置
    3. 預設值（`@william.chiang`）：如果未設置環境變數則使用此值
  - **重要**：AI 自動執行 `cr multiple-ticket` 命令時，**不應傳遞 `--reviewer` 參數**，讓腳本自動從環境變數讀取或使用預設值
- `--target=branch-name`：指定目標分支（預設: "main"）
  - **重要**：關於 Hotfix target branch 自動設置規則，請參考 `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的 "Target Branch" 章節
- `--no-draft`：不使用 draft 狀態（預設為 draft）
- `--no-review`：明確跳過 AI review（不送審）
- `--related-tickets="IN-1235,IN-1236"`：指定關聯單號（多個單號用逗號分隔）**（必須提供）**
- `--no-notify`：停用 Cursor rules 檢查失敗時的系統通知（預設為開啟）

**參數使用範例：**
- `cr multiple-ticket --related-tickets="IN-1235,IN-1236"`：明確指定關聯單號
- `cr multiple-ticket 這個改動包含所有子任務`：自動獲取子任務作為關聯單號
- `cr multiple-ticket --reviewer="@john.doe" --related-tickets="IN-1235,IN-1236"`：指定 reviewer 和關聯單號
- `cr multiple-ticket --target=develop --no-draft --related-tickets="IN-1235"`：目標分支為 develop，且不使用 draft 狀態

**重要：保護現有 Reviewer 規則**
- 如果 MR 已經存在且已有 reviewer，系統會自動檢查：
  - **如果用戶未明確指定 `--reviewer` 參數**（即使用預設值），系統會**保留現有的 reviewer**，不會更新
  - **如果用戶明確指定了 `--reviewer` 參數**（例如：`cr multiple-ticket --reviewer="@john.doe"`），系統會**更新 reviewer** 為指定的用戶
- 此規則適用於所有 `cr` 系列指令（`cr single-ticket`、`cr multiple-ticket`）

**注意：** 
- `cr multiple-ticket` 指令**必須**有多於一個 Jira ticket
- `cr multiple-ticket` 指令預設會送審；如需不送審，請使用 `--no-review`

**`cr single-ticket`** - 快速執行 commit 並建立 MR，略過關聯單號詢問（預設送審，可用 `--no-review` 跳過）

當用戶輸入 `cr single-ticket` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. 從上下文推斷 commit 信息（type, ticket, message）
3. 執行 commit 並推送到遠端
4. **略過關聯單號詢問環節**，直接使用當前分支單號
5. 自動建立 MR（包含 FE Board label、reviewer、draft 狀態、delete source branch）
6. **預設提交 AI review**（用戶可用 `--no-review` 明確跳過；若缺少 `COMPASS_API_TOKEN` 則會自動跳過 AI review；若為更新既有 MR，會由 `update-mr.mjs` 決定是否送審）

**參數支持：**
- `--reviewer="@username"`：指定 MR reviewer（預設: "@william.chiang"）
- `--target=branch-name`：指定目標分支（預設: "main"）
- `--no-draft`：不使用 draft 狀態（預設為 draft）
- `--no-review`：明確跳過 AI review（不送審）
- `--no-notify`：停用 Cursor rules 檢查失敗時的系統通知（預設為開啟）

**參數使用範例：**
- `cr single-ticket`：使用預設設定
- `cr single-ticket --reviewer="@john.doe"`：指定 reviewer 為 @john.doe
- `cr single-ticket --target=develop --no-draft`：目標分支為 develop，且不使用 draft 狀態

**重要：保護現有 Reviewer 規則**
- 如果 MR 已經存在且已有 reviewer，系統會自動檢查：
  - **如果用戶未明確指定 `--reviewer` 參數**（即使用預設值），系統會**保留現有的 reviewer**，不會更新
  - **如果用戶明確指定了 `--reviewer` 參數**（例如：`cr single-ticket --reviewer="@john.doe"`），系統會**更新 reviewer** 為指定的用戶
- 此規則適用於所有 `cr` 系列指令（`cr single-ticket`、`cr multiple-ticket`）

**注意：** 
- `cr single-ticket` 指令**預設會提交 AI review**，但用戶可明確指定 `--no-review` 跳過送審。
- `cr single-ticket` 指令不支援 `--related-tickets` 參數，因為它會自動略過關聯單號詢問環節。

**`commit-and-push`** - 快速執行 commit 並推送到遠端，不建立 MR 也不送審

當用戶輸入 `commit-and-push` 時，自動執行以下完整流程：
1. 檢查 Git 狀態
2. 從上下文推斷 commit 信息（type, ticket, message）
3. 執行 commit 並推送到遠端
4. **結束流程**（不建立 MR，不送審）

**注意：** `commit-and-push` 指令僅執行 commit 和 push 操作，不會建立 MR，也不會送審。如需建立 MR 和送審，請使用 `cr` 或 `cr-single-ticket` 指令。

---

當用戶說「幫我 commit」、「提交代碼」、「commit 並建立 MR」或類似指令時，執行以下流程：

**重要：AI review 提交邏輯（支援跨語系偵測）**
- **`cr multiple-ticket` 指令**：預設自動提交 AI review；用戶可用 `--no-review` 明確跳過
- **`cr single-ticket` 指令**：預設自動提交 AI review，且略過關聯單號詢問；用戶可用 `--no-review` 明確跳過
- **`commit-and-push` 指令**：不建立 MR，因此不涉及 AI review 提交
- **其他指令**（如「幫我 commit」、「提交代碼」等）：
  - 預設會提交 AI review
  - 只有在用戶**明確表達不送審**意圖時，才會自動使用 `--no-review` 參數跳過（支援中英文關鍵字，例如：「不要送審 / 不送審 / skip review / no review」）
  - **即使 chat 內容非中文，也能判斷是否包含類似的中文情境**

## 執行步驟

### 1. 檢查 Git 狀態
使用 `run_terminal_cmd` 執行 `git status` 檢查是否有變更需要提交：
- 如果沒有變更，告知用戶並結束流程
- 如果有變更，顯示變更的檔案列表

### 2. 獲取當前分支信息
使用 `run_terminal_cmd` 執行 `git rev-parse --abbrev-ref HEAD` 獲取當前分支名稱
- 如果分支是 main/master/develop，提示警告但允許繼續

**注意**：根據 `commit-and-mr-guidelines.mdc` 規範，rebase 已改為在建立 MR 前由 `create-mr.mjs` 自動執行。`create-mr.mjs` 會在建立 MR 前自動 rebase 到 target branch，並使用 `--force-with-lease` 推送（如果需要）。

### 3. 從上下文推斷 Commit 信息
根據以下優先順序獲取 commit 信息：

**優先順序 1: 用戶明確提供的信息**
- 如果用戶在指令中提供了 commit type、ticket 或 message，使用這些信息
- 例如：「幫我 commit，ticket 是 FE-7838，這是新功能」

**優先順序 2: 從最近的對話或變更推斷**
- 檢查最近修改的檔案和對話內容
- 從 Jira ticket 編號（如 FE-7838）推斷 ticket
- 從變更內容推斷 commit type：
  - 新增功能 → `feat`
  - 修復問題 → `fix`
  - 更新/優化 → `update`
  - 重構代碼 → `refactor`
  - 其他 → `chore`

**優先順序 3: 詢問用戶**
- 如果無法推斷，詢問用戶：
  - Commit type (feat/fix/update/refactor/chore/test/style/revert)
  - Jira ticket (格式: FE-1234)
  - Commit message (小寫，最大 64 字元)

### 3.9. 從 Fix Version 推斷目標分支（僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令）

**重要**：當用戶使用 `cr single-ticket` 或 `cr multiple-ticket` 指令時，`create-mr` 腳本會**自動**獲取 Jira ticket 的 fix version，並根據 fix version 推斷目標分支。

**自動推斷邏輯**（由 `create-mr` 腳本自動執行）：

1. **獲取 Jira ticket 的 fix version**：
   - 從分支名稱提取 ticket 編號（例如：`feature/IN-103698` → `IN-103698`）
   - 調用 `getJiraFixVersion()` 函數獲取 fix version
   - 如果無法獲取 fix version（例如：Jira API 配置缺失、網路問題等），記錄警告但繼續執行

2. **推斷目標分支**：
   - 如果 fix version 是 Hotfix 版本（格式：`major.minor.patch`，且 `patch` 非 0）：
     - 自動推斷目標分支為 `release/major.minor`
     - 例如：fix version `5.35.1` → 目標分支 `release/5.35`
     - 例如：fix version `5.35.3` → 目標分支 `release/5.35`
   - 如果 fix version 不是 Hotfix 版本（patch 為 0 或格式不符），使用預設值 `main`

**AI 執行注意事項**：
- AI **不應**在執行 `create-mr` 時傳遞 `--target` 參數，除非用戶明確指定了目標分支
- 如果用戶未指定 `--target` 參數，默認使用 `main` 作為目標分支
- `create-mr` 腳本會自動處理 fix version 的獲取和目標分支的推斷：
  - 如果獲取到 fix version 且為 Hotfix 版本，會自動將目標分支更新為對應的 `release/major.minor` 分支
  - 如果無法獲取 fix version 或不是 Hotfix 版本，則使用默認值 `main`
- 如果用戶明確指定了 `--target` 參數（例如：`cr --target=main`），則使用用戶指定的目標分支
- 如果用戶指定的目標分支與推斷的目標分支不一致（例如：Hotfix 但指定了 `main`），腳本會顯示警告並要求用戶確認

### 3.5. 自動偵測文字描述中的關聯單號（僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令）

**重要：** 當用戶使用 `cr single-ticket` 或 `cr multiple-ticket` 指令時，如果用戶在文字描述中提到了單號（例如：`IN-1234`、`FE-5678`、`IN-xxxx` 等格式），系統會自動偵測這些單號並詢問用戶是否要將它們添加到 `--related-tickets` 參數中。**支援跨語系偵測，即使內容非中文也能判斷。**

**偵測邏輯：**
- 使用正則表達式匹配單號格式：`[A-Z0-9]+-[0-9]+`（例如：`IN-1234`、`FE-5678`、`IN-xxxx` 等）
- 偵測關鍵字提示（中英文）：
  - **中文**：「關聯單號」、「相關單號」、「同時修復」、「一起修復」、「同步修復」、「相關的」、「關聯的」
  - **英文**：「related tickets」、「related ticket」、「also fixes」、「also fix」、「fixes also」、「related to」、「related issues」、「together with」、「along with」
- 排除當前分支的單號（已在分支名稱中的單號）
- 如果偵測到其他單號，在建立 MR 之前詢問用戶

**詢問流程範例：**
```
用戶輸入: "cr multiple-ticket 這個修改同時修復了 IN-1235 和 IN-1236 的問題"

1. 系統偵測到文字描述中的單號：IN-1235, IN-1236
2. 從分支名稱提取當前分支單號（例如：feature/IN-1234 → IN-1234）
3. 排除當前分支單號後，發現其他單號：IN-1235, IN-1236
4. 詢問用戶：
   "偵測到文字描述中提到了以下單號：IN-1235, IN-1236
    是否要將這些單號添加到 --related-tickets 參數中？
    1. 是，使用這些單號作為關聯單號
    2. 否，不使用關聯單號"
5. 根據用戶選擇：
   - 選擇「是」→ 自動添加 `--related-tickets="IN-1235,IN-1236"` 參數
   - 選擇「否」→ 不添加 `--related-tickets` 參數
```

**注意事項：**
- 此功能僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令
- 如果用戶已經明確提供了 `--related-tickets` 參數，則不進行自動偵測和詢問
- 如果用戶選擇「是」，系統會自動將偵測到的單號添加到 `--related-tickets` 參數中
- 對於 `cr single-ticket` 指令，雖然它不支援 `--related-tickets` 參數，但如果偵測到單號，仍會詢問用戶，並在用戶確認後提示該指令不支援此參數，建議使用 `cr multiple-ticket` 指令

### 3.6. 自動偵測文字描述中的 Reviewer（僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令）

**重要：** 當用戶使用 `cr single-ticket` 或 `cr multiple-ticket` 指令時，如果用戶在文字描述中提到了 reviewer 用戶名，系統會自動偵測並詢問用戶是否要將它設置為 `--reviewer` 參數。**支援跨語系偵測，即使內容非中文也能判斷。**

**偵測邏輯（支援中英文）：**
- 使用正則表達式匹配用戶名格式：`@?[a-zA-Z0-9._-]+`（例如：`@john.doe`、`john.doe`、`@william.chiang` 等）
- 偵測關鍵字提示：
  - **中文**：「reviewer」、「審查者」、「審查人」、「審核者」、「給 @」、「讓 @」、「請 @」、「由 @」、「交給 @」、「指定 @」、「設置 @」、「設置 reviewer」、「指定 reviewer」
  - **英文**：「reviewer」、「review by」、「review from」、「reviewer is」、「reviewer:」、「assign to」、「assign reviewer」、「set reviewer」、「for @」、「to @」、「by @」
- 排除常見的非用戶名詞彙（如 `main`、`develop`、`feature` 等分支相關詞彙）
- 如果偵測到多個用戶名，詢問用戶要使用哪一個

**詢問流程範例：**
```
用戶輸入: "cr multiple-ticket 請讓 @john.doe 審查這個修改"

1. 系統偵測到文字描述中的用戶名：@john.doe
2. 詢問用戶：
   "偵測到文字描述中提到了 reviewer：@john.doe
    是否要將此用戶設置為 --reviewer 參數？
    1. 是，使用 @john.doe 作為 reviewer
    2. 否，不使用 reviewer 參數（使用預設值 @william.chiang）
    3. 手動輸入其他 reviewer"

用戶選擇: 1

AI: 已設置 reviewer 為 @john.doe
```

**注意事項：**
- 此功能僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令
- 如果用戶已經明確提供了 `--reviewer` 參數，則不進行自動偵測和詢問
- 如果偵測到多個用戶名，會列出所有候選值供用戶選擇
- **如果用戶選擇「是」或明確指定了 reviewer**，系統會自動將偵測到的用戶名添加到 `--reviewer` 參數中，並在執行 `create-mr` 時傳遞該參數
- **如果用戶選擇「否」或未明確指定 reviewer**，執行 `create-mr` 時不傳遞 `--reviewer` 參數，讓腳本自動從環境變數讀取或使用預設值

### 3.7. 自動偵測文字描述中的目標分支（僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令）

**重要：** 當用戶使用 `cr single-ticket` 或 `cr multiple-ticket` 指令時，如果用戶在文字描述中提到了目標分支名稱，系統會自動偵測並詢問用戶是否要將它設置為 `--target` 參數。**支援跨語系偵測，即使內容非中文也能判斷。**

**偵測邏輯（支援中英文）：**
- 偵測常見分支名稱：`main`、`master`、`develop`、`dev`、`staging`、`production`、`prod`
- 偵測分支格式：`feature/xxx`、`bugfix/xxx`、`hotfix/xxx`、`release/xxx`
- 偵測關鍵字提示：
  - **中文**：「目標分支」、「合併到」、「合併至」、「merge to」、「target branch」、「target:」、「合併到 」、「合併至 」、「要合併到」、「要合併至」、「目標是」、「目標為」
  - **英文**：「target branch」、「target:」、「merge to」、「merge into」、「merge target」、「target is」、「targeting」、「to branch」、「into branch」
- 排除當前分支名稱（避免誤判）
- 如果偵測到多個分支名稱，詢問用戶要使用哪一個

**詢問流程範例：**
```
用戶輸入: "cr multiple-ticket 這個修改要合併到 develop 分支"

1. 系統偵測到文字描述中的分支名稱：develop
2. 詢問用戶：
   "偵測到文字描述中提到了目標分支：develop
    是否要將此分支設置為 --target 參數？
    1. 是，使用 develop 作為目標分支
    2. 否，不使用 target 參數（使用預設值 main）
    3. 手動輸入其他目標分支"

用戶選擇: 1

AI: 已設置目標分支為 develop
```

**注意事項：**
- 此功能僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令
- 如果用戶已經明確提供了 `--target` 參數，則不進行自動偵測和詢問
- 如果偵測到多個分支名稱，會列出所有候選值供用戶選擇
- 如果用戶選擇「是」，系統會自動將偵測到的分支名稱添加到 `--target` 參數中

### 3.8. 自動偵測文字描述中的 Draft 狀態（僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令）

**重要：** 當用戶使用 `cr single-ticket` 或 `cr multiple-ticket` 指令時，如果用戶在文字描述中提到了非草稿狀態的意圖，系統會自動偵測並詢問用戶是否要設置 `--no-draft` 參數。**支援跨語系偵測，即使內容非中文也能判斷。**

**偵測邏輯（支援中英文）：**
- **中文關鍵字**：「非草稿」、「不是草稿」、「直接提交」、「正式提交」、「ready for review」、「非 draft」、「不要 draft」、「不用 draft」、「不需要 draft」、「直接合併」、「正式合併」、「不要草稿」、「不用草稿」、「不需要草稿」
- **英文關鍵字**：「no draft」、「not draft」、「without draft」、「skip draft」、「direct submit」、「direct commit」、「ready for review」、「ready to merge」、「don't draft」、「not a draft」、「non-draft」、「final」、「ready」
- 如果偵測到相關關鍵字，詢問用戶是否要設置 `--no-draft` 參數

**詢問流程範例：**
```
用戶輸入: "cr multiple-ticket 這個修改直接提交，不要 draft"

1. 系統偵測到文字描述中的關鍵字：「直接提交」、「不要 draft」
2. 詢問用戶：
   "偵測到文字描述中提到了非草稿狀態的意圖
    是否要設置 --no-draft 參數（不使用 draft 狀態）？
    1. 是，設置 --no-draft 參數（MR 將不是草稿狀態）
    2. 否，不使用 --no-draft 參數（MR 將是草稿狀態，預設行為）"

用戶選擇: 1

AI: 已設置 --no-draft 參數
```

**注意事項：**
- 此功能僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令
- 如果用戶已經明確提供了 `--no-draft` 參數，則不進行自動偵測和詢問
- 如果用戶選擇「是」，系統會自動添加 `--no-draft` 參數
- 預設行為是使用 draft 狀態，只有明確提及非草稿意圖時才會詢問

### 4. 驗證 Commit 信息
確保符合 commitlint 規範：
- Type 必須是: feat, fix, update, refactor, chore, test, style, revert
- Ticket 必須符合格式: `[A-Z0-9]+-[0-9]+` (如 FE-7838)
- Message 必須是小寫，最大 64 字元

### 4.5. 檢查 Cursor Rules（在執行 commit 之前）

**CRITICAL**: 在執行 commit 之前，AI 必須檢查代碼是否符合 Cursor rules。

**最高優先級原則**：必須遵守 [ai-decision-making-priorities.mdc](mdc:.cursor/rules/ai-decision-making-priorities.mdc) 規則。當檢測到需要修改代碼的問題時，**必須立即停止並詢問用戶**，無論任務目標為何。**先詢問再修改 > 完成任務**。

**核心原則**：
- **不要自動修改代碼**
- **在 chat 中列出所有違規和修正建議**
- **每個改動提供 Apply 按鈕讓用戶選擇性套用**
- **套用完成後繼續原有的 commit 流程**

**處理流程概要**：

1. **檢查範圍**：檢查所有變更的檔案，特別是：
   - 是否符合架構規範（參考 `architecture-overview.mdc`）
   - State management 是否正確（Provider 不應有 side effects、API calls 等）
   - 組件命名和結構是否符合規範
   - 是否有其他 Cursor rules 違規

2. **如果檢測到違規**：
   - **立即停止 commit 流程**
   - **不要自動修改任何代碼**
   - **在 chat 中列出所有違規**，包括：
     - 違規摘要（總數、涉及檔案）
     - 每個違規的詳細信息（檔案、行號、違反規則、問題描述）
     - 修正建議和修正後的代碼示例
     - **每個改動提供 Apply 按鈕**
   - **檢查 `--no-notify` 參數**：如果用戶提供了 `--no-notify` 參數，則不發送系統通知
   - **可選通知**（如果未設置 `--no-notify`）：可以發送輕量級通知，但**不應強制切換視窗**，讓用戶在 chat 中處理
   - **等待用戶選擇套用修正**：用戶可以選擇套用部分或全部修正
   - **修正完成後繼續 commit 流程**：當用戶完成修正（或選擇跳過）後，繼續執行步驟 5

3. **如果通過檢查**：繼續執行 commit 流程

### 4.6. Bug 類型強制追溯來源（在執行 commit 之前）

**觸發條件**：Jira ticket 類型為 **Bug**

**CRITICAL**: 當 Jira ticket 類型為 Bug 時，在執行 commit 之前，**必須**追溯問題來源並在開發報告中包含「造成問題的單號」資訊。

**必須執行的步驟**：

1. **獲取 Jira ticket 類型**：
   - 使用 `read-jira-ticket.mjs` 腳本讀取 ticket 資訊
   - 檢查 `issueType` 欄位是否為 `Bug`

2. **追溯問題來源**（僅 Bug 類型）：
   - 執行 `git log --oneline -20 -- <changed-files>` 查看變更檔案的歷史記錄
   - 找出將功能「改壞」或「引入問題」的 commit
   - 記錄相關的 Jira ticket 或 MR

3. **在開發報告中包含「造成問題的單號」區塊**：
   - **必須包含**以下資訊：
     - 引入問題的 Commit（hash 和 message）
     - 相關 Jira Ticket（如有，使用超連結格式）
     - 引入日期
     - 說明（解釋為什麼該 commit 導致問題）

**強制輸出格式**：

在生成開發報告時，Bug 類型必須包含以下區塊：

```markdown
### 造成問題的單號

| 項目 | 值 |
|---|---|
| **引入問題的 Commit** | `{commit_hash}` |
| **相關 Jira Ticket** | [{ticket}](https://innotech.atlassian.net/browse/{ticket}) |
| **Commit Message** | {commit_message} |
| **引入日期** | {date} |
| **說明** | {explanation} |
```

**如果無法找到問題來源**：
- 標註「無法追溯」並說明原因（例如：問題存在於初始實現中）
- 仍需在報告中保留此區塊，內容填寫「無法追溯，問題存在於初始實現中」

**追溯命令範例**：

```bash
# 查看變更檔案的歷史記錄
git log --oneline -20 -- src/utilities/api/endpoint/bet-creator/sport-api.ts

# 查看特定 commit 的詳細信息
git show <commit_hash> --stat

# 搜尋包含特定關鍵字的 commit
git log --oneline --all --grep="sportGuestClient"
```

**禁止行為**：
- ❌ Bug 類型的開發報告中不包含「造成問題的單號」區塊
- ❌ 跳過追溯步驟直接生成報告
- ❌ 在無法追溯時不說明原因

### 5. 執行 Commit 流程

**前提條件**：必須在執行此步驟之前，先完成 Cursor rules 檢查（見步驟 4.5）和 Bug 類型追溯（見步驟 4.6，如適用）。如果檢測到違規，不要執行 commit。

**方法 A: 使用 agent-commit 腳本（推薦）**

如果已經獲取到所有必要信息（type, ticket, message），且**已確認代碼符合 Cursor rules**，直接使用腳本：

```bash
pnpm run agent-commit --type={type} --ticket={ticket} --message="{message}" [--skip-lint] [--auto-push]
```

參數說明：
- `--type`: commit type (feat/fix/update/refactor/chore/test/style/revert)
- `--ticket`: Jira ticket (如 FE-7838)
- `--message`: commit message (小寫，最大 64 字元)
- `--skip-lint`: 跳過 lint 檢查（可選）
- `--auto-push`: 自動推送到遠端（可選）

**方法 B: 手動執行步驟**

如果無法使用腳本，按以下步驟執行：

1. **運行 Lint 檢查（可選但建議）**
   - 詢問用戶是否運行 lint 檢查
   - 如果用戶同意或未明確拒絕，執行 `pnpm run format-and-lint`
   - 如果 lint 失敗，提示用戶修復錯誤後再繼續

2. **添加檔案**
   - 執行 `git add .` 添加所有變更

3. **創建 Commit**
   - 使用格式化的 commit message 創建 commit：
     ```
     {type}({ticket}): {message}
     ```
   - 例如：`feat(FE-7838): enable new sport baseball in stg, dev, and demo environments`
   - 執行：`git commit -m "{commitMessage}"`

4. **推送到遠端**
   - 詢問用戶是否推送到遠端
   - 如果同意，執行 `git push origin {branch-name}`
   - 如果是新分支，使用 `git push -u origin {branch-name}`

5. **詢問關聯單號（建立 MR 前）**
   
   **注意：`cr single-ticket` 指令會跳過此步驟，直接使用當前分支單號。**
   
   **CRITICAL**: 在建立 MR 之前，**必須先驗證關聯單號**：
   - 驗證關聯單號是否存在於 Jira 中
   - 驗證關聯單號是否與當前分支名稱匹配
   - 如果關聯單號不存在或不匹配，必須要求用戶重新確認
   
   在建立 MR 之前，**必須先詢問用戶**是否除了當前分支單號外有同步修復其他單號：
   
   - 從當前分支名稱提取單號（例如：`feature/IN-1234` → `IN-1234`）
   
   **自動偵測邏輯（僅適用於 `cr single-ticket` 和 `cr multiple-ticket` 指令）：**
   - 如果用戶在文字描述中提到了單號（例如：`IN-1234`、`FE-5678` 等格式），系統會自動偵測這些單號
   - 排除當前分支的單號後，如果發現其他單號，優先使用自動偵測的結果
   - 如果用戶已經明確提供了 `--related-tickets` 參數，則使用參數中的值，不進行自動偵測
   
   **詢問流程：**
   
   **情況 A: 偵測到文字描述中的單號（優先）**
   ```
   用戶輸入: "cr multiple-ticket 這個修改同時修復了 IN-1235 和 IN-1236 的問題"
   當前分支: feature/IN-1234
   
   1. 系統偵測到文字描述中的單號：IN-1235, IN-1236
   2. 排除當前分支單號 IN-1234 後，發現其他單號：IN-1235, IN-1236
   3. 詢問用戶：
      "偵測到文字描述中提到了以下單號：IN-1235, IN-1236
       是否要將這些單號添加到 --related-tickets 參數中？
       1. 是，使用這些單號作為關聯單號
       2. 否，不使用關聯單號
       3. 手動輸入其他關聯單號"
   
   用戶選擇: 1
   
   AI: 已記錄關聯單號：IN-1235, IN-1236
   ```
   
   **情況 B: 未偵測到單號或用戶選擇「否」**
   ```
   當前分支: feature/IN-1234
   
   AI: 請問除了當前分支單號 IN-1234 外，是否有同步修復其他單號？
       1. 有
       2. 無
   
   用戶選擇: 1
   
   AI: 請提供關聯單號（多個單號請用空格或逗號分隔）：
   
   用戶輸入: IN-1235 IN-1236
   
   AI: 已記錄關聯單號：IN-1235, IN-1236
   ```
   
   **關聯單號處理邏輯：**
   - 如果用戶選擇「有」並提供關聯單號（無論是自動偵測還是手動輸入），**必須先驗證關聯單號**：
     - **驗證關聯單號是否存在**：使用 `checkJiraTicketExists()` 檢查每個關聯單號是否在 Jira 中存在
     - **驗證關聯單號是否與當前分支名稱匹配**：檢查關聯單號是否與當前分支名稱中的單號一致
     - **如果關聯單號不存在或不匹配**：
       1. 在 chat 中告知用戶哪些關聯單號有問題
       2. 要求用戶重新確認關聯單號
       3. 提供選項讓用戶選擇其中一張作為新的分支名稱（如果當前分支單號有問題）
       4. 如果用戶選擇更換分支名稱，需要重命名分支後重新執行流程
   - 如果所有關聯單號驗證通過，將所有單號（當前分支單號 + 關聯單號）合併
   - 格式：`當前分支單號 , 關聯單號1 , 關聯單號2 , ...`
   - 範例：分支 `feature/IN-1234`，關聯單號 `IN-1235 IN-1236` → MR description: `IN-1234 , IN-1235 , IN-1236`
   - 如果用戶選擇「無」，只使用當前分支單號：`IN-1234`
   
   **關聯單號驗證範例：**
   ```
   當前分支: feature/IN-1234
   用戶提供的關聯單號: IN-1235, IN-1236, FE-9999
   
   1. 驗證 IN-1235 → 存在 ✓
   2. 驗證 IN-1236 → 不存在 ✗
   3. 驗證 FE-9999 → 存在，但與當前分支單號 IN-1234 不匹配 ✗
   
   AI: ⚠️ 驗證關聯單號時發現問題：
       - IN-1236: 在 Jira 中不存在
       - FE-9999: 與當前分支單號 IN-1234 不匹配
       
       請選擇處理方式：
       1. 移除有問題的單號（IN-1236, FE-9999），只使用 IN-1235
       2. 重新輸入關聯單號
       3. 將 FE-9999 設為新的分支名稱（會重命名分支為 feature/FE-9999）
   ```

6. **驗證 MR 建立所需信息（在建立 MR 之前）**

   **CRITICAL**: 根據 `commit-and-mr-guidelines.mdc` 規範，在建立 MR 之前，**MUST** 驗證所有必需信息。

   **詳細流程請參考**: `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的 "Information Validation Before MR Creation" 章節。

   **必需信息檢查清單**：

   1. **GitLab 信息**：
      - GitLab API 連線狀態
      - 當前用戶信息（用於 assignee）
      - 項目信息
      - 分支信息

   2. **Jira Ticket 信息**：
      - Jira ticket 編號（從分支名稱或 commit message 獲取）
      - Jira ticket 標題/摘要（用於 MR 標題）
      - Jira ticket 狀態和有效性
      - **Fix version 信息（必須獲取）**：用於推斷目標分支和添加版本 label

   3. **MR 配置信息**：
      - Labels（UI 版本標籤、FE Board、Static File、Vendor Customization 等）
      - Reviewer 信息（從命令參數、用戶偏好或預設值）
      - Assignee 信息
      - Draft 狀態偏好
      - **目標分支（從 fix version 推斷）**：如果 fix version 是 Hotfix（patch 非 0），自動推斷目標分支為 `release/major.minor`

   **從 Fix Version 推斷目標分支（CRITICAL）**：

   **重要**：在建立 MR 之前，**必須**先獲取 Jira ticket 的 fix version，並根據 fix version 推斷目標分支。

   **推斷規則**：
   - 如果 fix version 是 Hotfix 版本（格式：`major.minor.patch`，且 `patch` 非 0）：
     - 自動推斷目標分支為 `release/major.minor`
     - 例如：fix version `5.35.1` → 目標分支 `release/5.35`
     - 例如：fix version `5.35.3` → 目標分支 `release/5.35`
   - 如果用戶明確指定了 `--target` 參數，則使用用戶指定的目標分支（但仍會檢查是否正確）
   - 如果 fix version 不是 Hotfix 版本（patch 為 0 或格式不符），則使用預設值 `main`

   **執行流程**：
   1. 獲取 Jira ticket 的 fix version（在 `create-mr` 腳本中自動執行）
   2. 如果 fix version 是 Hotfix 版本，且用戶**沒有明確指定** `--target` 參數：
      - 自動推斷目標分支為 `release/major.minor`
      - 在控制台輸出推斷結果：`🎯 檢測到 Hotfix 版本 5.35.1，自動推斷目標分支: release/5.35`
   3. 如果用戶明確指定了 `--target` 參數，但 fix version 是 Hotfix 且目標分支不是 `release/*`：
      - 顯示警告訊息
      - 提示建議的目標分支（從 fix version 推斷）
      - 發送系統通知（除非使用 `--no-notify`）
      - 要求用戶確認是否繼續使用指定的目標分支

   **如果信息獲取失敗**：
   - **立即停止 MR 建立流程**
   - **在 chat 中提供清晰反饋**：
     - 指出哪些具體信息缺失或無法獲取
     - 解釋根本原因（網路問題、配置問題等）
     - 提供可操作的解決指導
     - 列出用戶需要採取的具體步驟
   - **發送系統通知**：
     - 觸發系統通知提醒用戶問題
     - 包含與 chat 反饋相同的信息
     - 確保通知可見且可操作
   - **等待用戶解決**：
     - 不要繼續建立 MR，直到所有信息成功獲取
     - 用戶修復問題後，重新驗證所有信息再繼續

7. **建立 Merge Request（如果用戶要求）**
   
   如果用戶要求建立 MR（例如「commit 並建立 MR」），且**所有必需信息已成功驗證**，執行以下步驟：
   
   **🚨 CRITICAL - 建立 MR 前的強制參數準備：**
   
   在執行 `create-mr.mjs` 前，**必須**準備以下參數：
   
   | 參數 | 來源 | 必要性 | 說明 |
   |---|---|---|---|
   | `--development-report` | 根據 Jira 資訊和變更內容生成 | **必須** | 直接以字串傳入；**Agent 必須確保不跑版**（避免 MR description 出現字面 `\n`） |
   | `--agent-version` | 從 `version.json` 讀取 | **必須** | 優先順序：`.pantheon/version.json` → `version.json` → `.cursor/version.json` |
   | `--labels` | AI 在建立 MR 前判定 | **必須** | AI 必須先讀 `adapt.json` + Jira + 改動範圍，判定 labels，並透過 `--labels="a,b,c"` 傳入（腳本仍會做白名單/存在性過濾） |
   | `--reviewer` | 僅用戶明確指定時傳遞 | 可選 | 未指定時讓腳本使用環境變數或預設值 |
   | `--related-tickets` | 從用戶輸入或自動偵測 | 可選 | 多個單號用逗號分隔 |
   
   ### 🚨 CRITICAL - 建立 MR 前必須先判定 labels（使用 adapt.json）
   
   **目標**：在呼叫 `create-mr` 建立 MR 之前，AI 必須先參考 repo knowledge（`adapt.json`）的 label 定義，綜合 Jira ticket 資訊與改動範圍，做出「本次應使用哪些 labels」的判斷，並透過 `--labels` 手動傳入 MR 腳本。
   
   **AI 必做資訊來源**：
   1. `adapt.json`：`adapt.json`
      - 使用 `adapt.json.labels` 作為 **可用 label 清單**（只可從清單中挑選，不可創造新 label）
      - 只使用 `applicable.ok === true`（或 `applicable` 缺失 / `applicable === true`）的 labels
   2. Jira ticket info：標題 / 類型 / fix version（Hotfix 可能影響 target branch）
   3. 改動範圍：`git diff --name-status origin/{targetBranch}...HEAD`、`git diff --stat ...`、近期 commits
   
   **AI 在 chat 中的輸出要求（建立 MR 前）**：
   - 先列出「建議 labels」與「原因」，至少包含下列表格：
   
     | Label | 判定原因（對應 Jira / 改動範圍） |
     |---|---|
     | ... | ... |
   
   **傳入 `create-mr` 的方式**：
   - 使用 `--labels="label1,label2,label3"`（逗號分隔）
   - 建議 **只傳入需要 AI 補齊的額外 labels**（例如 UI 版本類 / domain 類 labels）；`AI` / `FE Board` / `Hotfix` 等腳本自動處理的 labels 仍會由腳本自行加入
   - 腳本會再以 `adapt.json` 做白名單過濾，不在清單內的 labels 會被濾掉
   
   **開發報告生成步驟：**
   1. 讀取 Jira ticket 資訊（標題、類型）
   2. 分析 `git diff` 和 `git status` 獲取變更檔案
   3. 根據 Jira 類型（Bug/Request/其他）生成對應格式的報告
   4. 詳細格式請參考 `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的「Development Report Requirement」章節
   
   **版本資訊讀取步驟：**
   1. 按優先順序檢查版本檔案是否存在
   2. 讀取 JSON 內容並提取版本欄位
   3. 將版本資訊作為 JSON 字串傳遞
   
   **禁止行為：**
   - ❌ 執行 `create-mr` 時不傳入 `--development-report`
   - ❌ 執行 `create-mr` 時不傳入 `--agent-version` 參數
   - ❌ 生成不完整的開發報告（缺少關聯單資訊或變更摘要）
   
   **方法 A: 建立新 MR：使用 create-mr 腳本**
   
   腳本會自動使用 GitLab CLI (glab) 或 API token 建立 MR：
   
   ```bash
   node .cursor/scripts/cr/create-mr.mjs --development-report="<markdown>" --agent-version='<版本JSON>' --labels="label1,label2" [--reviewer="@username"] [--target=main] [--no-draft] [--no-review] [--related-tickets="IN-1235,IN-1236"] [--no-notify]
   ```

   **方法 B: 更新既有 MR：使用 update-mr 腳本（任何 MR 修改一律走此腳本）**

   ```bash
   node .cursor/scripts/cr/update-mr.mjs --development-report="<markdown>"
   ```
   
   **參數說明：**
   - `--reviewer`: Reviewer 用戶名（**僅在用戶明確指定時使用**，支持 @ 符號格式）
     - **Reviewer 優先順序**：
       1. 命令行參數（`--reviewer=`）：最高優先級，用戶明確指定
       2. 環境變數（`.env.local` 中的 `MR_REVIEWER`）：用戶偏好設置
       3. 預設值（`@william.chiang`）：如果未設置環境變數則使用此值
     - **重要**：AI 自動執行 `create-mr` 腳本時的處理方式：
       - **如果用戶明確指定了 reviewer**（例如：在指令中提供了 `--reviewer` 參數，或在文字描述中提到了 reviewer 並確認使用），**必須傳遞 `--reviewer` 參數**
       - **如果用戶未明確指定 reviewer**（未提供參數且未在文字描述中提及），**不應傳遞 `--reviewer` 參數**，讓腳本自動從環境變數讀取或使用預設值
   - `--target`: 目標分支（預設: "main"）
     - **重要**：關於 Hotfix target branch 自動設置規則，請參考 `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的 "Target Branch" 章節
     - **Hotfix Target Branch 自動設置規則**（摘要）：
       - 如果 Jira ticket 的 fix version 符合 hotfix 條件（小版號不為 0，例如：`5.35.1`），系統會自動添加 `Hotfix` label
       - **同時，系統會自動將 target branch 設置為對應的 release branch**（例如：fix version `5.35.1` → target branch `release/5.35`）
       - 此自動設置會覆蓋預設值（`main`），但**不會覆蓋用戶明確指定的 `--target` 參數**
       - 如果用戶明確指定了不同的 target branch（例如：`--target=main`），系統會提示確認，因為 Hotfix 通常應該合併到 release/* 分支
       - **範例**：
         - Jira ticket fix version: `5.35.1` → 自動設置 target branch 為 `release/5.35`
         - Jira ticket fix version: `5.35.0` → 不觸發 hotfix 規則，使用預設值或用戶指定的 target branch
         - Jira ticket fix version: `5.35.2` → 自動設置 target branch 為 `release/5.35`
   - `--no-draft`: 不使用 draft 狀態（預設為 draft）
   - `--no-review`: 不自動提交 AI review（預設為自動提交）
   - `--related-tickets`: 關聯單號（多個單號用逗號分隔）
   - `--no-notify`: 停用系統通知功能（預設為開啟）。當需要用戶在 chat 中確認時（如 Hotfix MR 確認、Jira 配置缺失等），不會發送系統通知
   
   **重要：當找不到 reviewer 時的處理流程**
   
   如果指定的 reviewer 在 GitLab 中找不到，腳本會輸出錯誤訊息並退出。此時 AI 應該：
   
   1. **在 Cursor chat 中詢問用戶**：
      - "未找到 reviewer: @xxx"
      - "請選擇："
      - "1. 使用預設 reviewer (william.chiang)"
      - "2. 重新輸入 reviewer 用戶名"
   
   2. **根據用戶的回應**：
      - 如果選擇「使用預設」：重新執行 `pnpm run create-mr`（不傳遞 `--reviewer` 參數，讓腳本使用預設值 `@william.chiang`）
      - 如果選擇「重新輸入」：詢問用戶輸入新的 reviewer 用戶名，然後重新執行 `pnpm run create-mr --reviewer="<新的reviewer>" ...`
   
   3. **重複步驟 1-2**，直到找到有效的 reviewer 或用戶選擇使用預設 reviewer
   
   **注意**：系統會強制設置 reviewer，無法跳過。必須找到有效的 reviewer 或使用預設 reviewer 才能繼續。
  **注意：** 所有通過 `create-mr` 腳本建立的 MR，都會基於改動內容自動判斷並添加對應的 labels。
   
   **FE Board Label 添加規則：**
   - **CRITICAL**: 只有當前分支使用的單號（從分支名稱提取的單號）是 `FE-` 開頭時，才添加 `FE Board` label
   - 關聯單號（`--related-tickets`）中的 `FE-` 開頭單號**不會**觸發 `FE Board` label 的添加
   - 範例：
     - 分支 `feature/FE-1234`，關聯單號 `IN-5678` → 添加 `FE Board` label（因為當前分支單號是 FE-1234）
     - 分支 `feature/IN-1234`，關聯單號 `FE-5678` → **不添加** `FE Board` label（因為當前分支單號是 IN-1234，不是 FE 開頭）
     - 分支 `feature/FE-1234`，無關聯單號 → 添加 `FE Board` label
   
  **AI review 判斷邏輯：**
  - **`cr multiple-ticket` 指令**：預設提交 AI review；只有在用戶明確要求不送審時才添加 `--no-review`
  - **`cr single-ticket` 指令**：預設提交 AI review；只有在用戶明確要求不送審時才添加 `--no-review`；且不添加 `--related-tickets` 參數（略過關聯單號詢問）
  - **`commit-and-push` 指令**：不建立 MR，因此不涉及此判斷邏輯
  - **其他指令**：預設提交 AI review；只有在用戶明確要求不送審時才添加 `--no-review`
   
   參數說明：
   - `--reviewer`: Reviewer 用戶名（**僅在用戶明確指定時使用**，支持 @ 符號格式）
     - **Reviewer 優先順序**：
       1. 命令行參數（`--reviewer=`）：最高優先級，用戶明確指定
       2. 環境變數（`.env.local` 中的 `MR_REVIEWER`）：用戶偏好設置
       3. 預設值（`@william.chiang`）：如果未設置環境變數則使用此值
     - **重要**：AI 自動執行 `create-mr` 腳本時的處理方式：
       - **如果用戶明確指定了 reviewer**（例如：在指令中提供了 `--reviewer` 參數，或在文字描述中提到了 reviewer 並確認使用），**必須傳遞 `--reviewer` 參數**
       - **如果用戶未明確指定 reviewer**（未提供參數且未在文字描述中提及），**不應傳遞 `--reviewer` 參數**，讓腳本自動從環境變數讀取或使用預設值
   - `--target`: 目標分支（預設: "main"）
     - **重要**：關於 Hotfix target branch 自動設置規則，請參考 `.cursor/rules/cr/commit-and-mr-guidelines.mdc` 中的 "Target Branch" 章節
     - **Hotfix Target Branch 自動設置規則**（摘要）：
       - 如果 Jira ticket 的 fix version 符合 hotfix 條件（小版號不為 0，例如：`5.35.1`），系統會自動添加 `Hotfix` label
       - **同時，系統會自動將 target branch 設置為對應的 release branch**（例如：fix version `5.35.1` → target branch `release/5.35`）
       - 此自動設置會覆蓋預設值（`main`），但**不會覆蓋用戶明確指定的 `--target` 參數**
       - 如果用戶明確指定了不同的 target branch（例如：`--target=main`），系統會提示確認，因為 Hotfix 通常應該合併到 release/* 分支
       - **範例**：
         - Jira ticket fix version: `5.35.1` → 自動設置 target branch 為 `release/5.35`
         - Jira ticket fix version: `5.35.0` → 不觸發 hotfix 規則，使用預設值或用戶指定的 target branch
         - Jira ticket fix version: `5.35.2` → 自動設置 target branch 為 `release/5.35`
   - `--no-draft`: 不使用 draft 狀態（預設為 draft）
   - `--no-review`: 跳過 AI review 提交
   - `--related-tickets`: 關聯單號（多個單號用逗號分隔，例如: `"IN-1235,IN-1236"`）
   
   **腳本會自動：**
   - 優先使用 GitLab CLI (glab)，使用用戶的 GitLab 帳號權限
   - 如果 glab 不可用，嘗試使用 API token
   - **自動設置為 Draft 狀態**（除非使用 `--no-draft`）
  - **自動分析改動檔案並添加對應的 labels**（根據影響範圍）
   - 自動添加 reviewer
   - 使用當前分支和 commit message 作為 MR 標題
   - **自動設定 delete source branch**（MR 合併後自動刪除來源分支）
   - **自動處理關聯單號**：
     - 如果提供了 `--related-tickets` 參數，將當前分支單號和關聯單號合併到 MR description
     - 格式：`當前分支單號 , 關聯單號1 , 關聯單號2 , ...`
     - 如果未提供，只使用當前分支單號
  - **AI review 提交邏輯**：
    - `cr multiple-ticket` 指令：預設提交 AI review；只有在用戶明確要求不送審時才添加 `--no-review`
    - `cr single-ticket` 指令：預設提交 AI review；只有在用戶明確要求不送審時才添加 `--no-review`
    - `commit-and-push` 指令：不建立 MR，因此不涉及 AI review 提交
    - 其他指令：預設提交 AI review；只有在用戶明確要求不送審時才添加 `--no-review`
   - **Cursor rules 檢查失敗通知**（支持 macOS 和 Windows）：
     - 當 AI 在執行 commit **之前**檢測到代碼違反 Cursor rules 時，系統會自動顯示系統通知
       - **macOS**：在右上角顯示系統通知
       - **Windows**：在右下角顯示 Toast 通知（Windows 10+）
     - 通知會提示用戶返回 Cursor 修正問題
     - 系統會自動切換視窗到 Cursor 應用，方便用戶進行修正
     - 通知包含 MR 連結（如果有的話），方便用戶查看
     - Windows 系統會自動嘗試使用 Toast 通知，如果失敗則回退到 `msg` 命令
     - **檢測機制**：AI 在執行 commit 之前會根據 `.cursor/rules/` 中的規則檢查代碼變更。如果檢測到違規（如 Provider 中有 side effects、架構違規等），會調用 `notifyCursorRulesFailed` 函數發送通知並停止 commit 流程
     - **點擊通知切換**：通知不會自動切換視窗，只有在用戶點擊通知時才會切換到對應的 Cursor 視窗
     - **多視窗支持**：系統會嘗試根據當前工作目錄識別對應的 Cursor 視窗，如果有多個 Cursor 視窗同時運行，會切換到匹配的視窗
     - **停用通知**：可以使用 `--no-notify` 參數停用通知功能（默認開啟）
   
   **方法 B: 提供 MR 連結（如果無法使用腳本）**
   - 獲取 GitLab remote URL
   - 生成 MR 建立連結並提供給用戶：
     ```
     https://{gitlab-host}/{project-path}/-/merge_requests/new?merge_request[source_branch]={branch-name}&merge_request[target_branch]=main&merge_request[work_in_progress]=true
     ```

### 6. 在 Chat 中提供執行結果（建立 MR 後）

**CRITICAL**: 當 MR 建立成功後，**必須**在 chat 中按照用戶常用語言（中文或英文）提供格式化的執行結果報告。

**詳細要求請參考**: `.cursor/rules/cr/mr-execution-result-report.mdc`

**執行結果必須包含以下三個部分：**

1. **Commit 資訊**：
   - Type, Ticket, Message, Commit Hash

2. **Merge Request 資訊**：
   - MR 連結, MR ID, 標題, 狀態, Reviewer, Labels, 關聯 Jira, AI Review 狀態

3. **變更內容**：
   - 列出新增、更新、還原的檔案，每個檔案附上簡要說明

**語言檢測**：
- 如果用戶在 chat 中使用中文，使用中文格式
- 如果用戶在 chat 中使用英文，使用英文格式
- 如果無法確定，預設使用中文

**獲取信息的方法**：
- Commit 資訊：從 commit message 和 `git rev-parse HEAD` 獲取
- MR 資訊：從 `create-mr` 腳本的輸出中獲取
- 變更內容：使用 `git status` 和 `git diff --name-status` 獲取

## Commit Message 範例

根據變更內容自動生成合適的 commit message：

- 新功能：`feat(FE-7838): enable new sport baseball in stg, dev, and demo environments`
- 修復問題：`fix(IN-1234): resolve memory leak in sport game component`
- 更新：`update(FE-5678): upgrade dependencies to latest version`
- 重構：`refactor(IN-9012): refactor sport helper functions for better performance`

**重要：Commit message 必須使用英文，不允許使用中文。**

## 使用範例

**範例 0: 用戶輸入 `cr multiple-ticket`（必須提供多個 ticket，預設送審）**
```
用戶輸入: "cr multiple-ticket 這個修改同時修復了 IN-1235 和 IN-1236"
1. 自動檢查 git 狀態 → 發現變更
2. **驗證多 ticket 要求**：偵測到 IN-1235 和 IN-1236 → 驗證通過
3. 自動從上下文推斷：
   - Type: feat (從變更內容推斷)
   - Ticket: FE-7841 (從分支名稱推斷)
   - Message: add ocr image locale check tool (從變更檔案推斷)
4. 自動執行: pnpm run agent-commit --type=feat --ticket=FE-7841 --message="add ocr image locale check tool" --auto-push
5. 自動執行: pnpm run create-mr --related-tickets="IN-1235,IN-1236"
6. MR description: FE-7841 , IN-1235 , IN-1236
7. 預設提交 AI review（如需不送審，可用 `--no-review`）
8. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

**範例 0-0: 用戶使用「主單與所有子任務」意圖**
```
用戶輸入: "cr multiple-ticket 這個改動包含主單和所有子任務"
當前分支: feature/FE-7841

1. 自動檢查 git 狀態 → 發現變更
2. **偵測到子任務意圖**：「主單和所有子任務」
3. AI 詢問：
   "偵測到您的意圖可能是「以當前主單與所有關聯子任務進行」。
    當前分支單號: FE-7841
    
    請確認：
    1. 是，自動獲取 FE-7841 的所有子任務並作為關聯單號
    2. 否，我會手動提供關聯單號"

4. 用戶選擇: 1
5. AI 執行: node .cursor/scripts/jira/read-jira-ticket.mjs "FE-7841"
6. 從回傳 JSON 的 raw.fields.subtasks 提取子任務：FE-7842, FE-7843, FE-7844
7. AI 確認：
   "找到以下子任務：
    - FE-7842: 子任務標題 1
    - FE-7843: 子任務標題 2
    - FE-7844: 子任務標題 3
    
    是否使用這些子任務作為關聯單號？
    1. 是，全部使用
    2. 否，我要選擇部分
    3. 取消，改用其他方式"

8. 用戶選擇: 1
9. 自動執行 commit 和 create-mr --related-tickets="FE-7842,FE-7843,FE-7844"
10. MR description: FE-7841 , FE-7842 , FE-7843 , FE-7844
11. 自動提交 AI review
```

**範例 0-0-1: 用戶只提供一個 ticket 且無子任務意圖（被拒絕）**
```
用戶輸入: "cr multiple-ticket"
當前分支: feature/FE-7841

1. 自動檢查 git 狀態 → 發現變更
2. **驗證多 ticket 要求**：只有當前分支單號 FE-7841 → 驗證失敗
3. AI 提示：
   "⚠️ `cr multiple-ticket` 指令必須提供多於一個 Jira ticket。
    
    請選擇：
    1. 提供關聯單號（手動輸入）
    2. 自動獲取當前分支單號 FE-7841 的所有子任務
    3. 改用 `cr single-ticket` 指令（僅使用當前分支單號）"

4. 用戶選擇: 3
5. AI 使用 cr single-ticket 流程繼續
```

**範例 0-1: 用戶輸入 `cr single-ticket`（快速，略過關聯單號詢問，預設送審）**
```
用戶輸入: "cr single-ticket"
1. 自動檢查 git 狀態 → 發現變更
2. 自動從上下文推斷：
   - Type: feat (從變更內容推斷)
   - Ticket: FE-7841 (從分支名稱推斷)
   - Message: add ocr image locale check tool (從變更檔案推斷)
3. 自動執行: pnpm run agent-commit --type=feat --ticket=FE-7841 --message="add ocr image locale check tool" --auto-push
4. 從分支名稱提取單號（例如：feature/FE-7841 → FE-7841）
5. **略過關聯單號詢問環節**，直接使用當前分支單號
6. 自動執行: pnpm run create-mr（不傳遞 --reviewer 參數，讓腳本自動從環境變數讀取或使用預設值）
   - **注意**：如果用戶在指令中明確指定了 reviewer（例如：`cr single-ticket 請讓 @john.doe 審查`），則應傳遞 `--reviewer="@john.doe"` 參數
7. MR description: FE-7841
8. 預設提交 AI review（如需不送審，可用 `--no-review`）
9. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

**範例 0-2: 用戶輸入 `commit-and-push`（快速，僅 commit 和 push）**
```
用戶輸入: "commit-and-push"
1. 自動檢查 git 狀態 → 發現變更
2. 自動從上下文推斷：
   - Type: feat (從變更內容推斷)
   - Ticket: FE-7841 (從分支名稱推斷)
   - Message: add ocr image locale check tool (從變更檔案推斷)
3. 自動執行: pnpm run agent-commit --type=feat --ticket=FE-7841 --message="add ocr image locale check tool" --auto-push
4. `commit-and-push` 指令僅執行 commit 和 push，不建立 MR，也不送審
5. 流程結束
```

**範例 1: 用戶說「幫我 commit」**
```
1. 檢查 git 狀態 → 發現變更
2. 從對話推斷：最近在修改 sport.constants.ts，添加了棒球功能
3. 推斷信息：
   - Type: feat (新功能)
   - Ticket: FE-7838 (從對話中獲取)
   - Message: enable new sport baseball in stg, dev, and demo environments
4. 執行: pnpm run agent-commit --type=feat --ticket=FE-7838 --message="enable new sport baseball in stg, dev, and demo environments" --auto-push
```

**範例 2: 用戶說「提交代碼，ticket 是 FE-7838」**
```
1. 檢查 git 狀態 → 發現變更
2. 使用用戶提供的 ticket: FE-7838
3. 從變更內容推斷 type 和 message
4. 執行 commit 流程
```

**範例 3: 用戶說「commit 並推送到遠端」**
```
1. 檢查 git 狀態
2. 推斷或詢問 commit 信息
3. 執行 commit 並使用 --auto-push 參數
```

**範例 4: 用戶說「commit 並建立 MR」或「幫我建立 MR」（預設送審）**
```
1. 檢查 git 狀態（如果有變更，先執行 commit）
2. 從分支名稱提取單號（例如：feature/IN-1234 → IN-1234）
3. 詢問用戶：除了當前分支單號 IN-1234 外，是否有同步修復其他單號？
   選項：1. 有  2. 無
4. 用戶選擇：2（無）
5. 執行: pnpm run create-mr（不傳遞 --reviewer 參數，讓腳本自動從環境變數讀取或使用預設值）
7. 腳本會自動使用 glab 或 API token 建立 MR
8. MR description: IN-1234
9. 預設提交 AI review
10. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

**範例 4-1: 用戶選擇有關聯單號**
```
1. 檢查 git 狀態（如果有變更，先執行 commit）
2. 從分支名稱提取單號（例如：feature/IN-1234 → IN-1234）
3. 詢問用戶：除了當前分支單號 IN-1234 外，是否有同步修復其他單號？
   選項：1. 有  2. 無
4. 用戶選擇：1（有）
5. 詢問用戶：請提供關聯單號（多個單號請用空格或逗號分隔）
6. 用戶輸入：IN-1235 IN-1236
7. 執行: pnpm run create-mr --related-tickets="IN-1235,IN-1236"（不傳遞 --reviewer 參數，讓腳本自動從環境變數讀取或使用預設值）
9. 腳本會自動使用 glab 或 API token 建立 MR
10. MR description: IN-1234 , IN-1235 , IN-1236
11. 預設提交 AI review
12. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

**範例 4-2: 用戶說「commit 並建立 MR，不送審」**
```
1. 檢查 git 狀態（如果有變更，先執行 commit）
2. 從分支名稱提取單號（例如：feature/IN-1234 → IN-1234）
3. 詢問用戶：除了當前分支單號 IN-1234 外，是否有同步修復其他單號？
   選項：1. 有  2. 無
4. 用戶選擇：2（無）
5. 檢查用戶訊息 → 檢測到「不送審」意圖
6. 執行: pnpm run create-mr --no-review（不傳遞 --reviewer 參數，讓腳本自動從環境變數讀取或使用預設值）
7. 腳本會自動使用 glab 或 API token 建立 MR
8. MR description: IN-1234
9. 跳過 AI review 提交（--no-review）
10. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

**範例 5: 用戶說「幫我 commit 並建立 MR，reviewer 是 @john.doe」**
```
1. 檢查 git 狀態 → 發現變更
2. 推斷 commit 信息
3. 執行: pnpm run agent-commit --type=feat --ticket=FE-7838 --message="..." --auto-push
4. 從分支名稱提取單號（例如：feature/FE-7838 → FE-7838）
5. 詢問用戶：除了當前分支單號 FE-7838 外，是否有同步修復其他單號？
   選項：1. 有  2. 無
6. 用戶選擇：2（無）
7. **檢測到用戶明確指定了 reviewer: @john.doe** → 執行: pnpm run create-mr --reviewer="@john.doe"
   - **注意**：因為用戶明確指定了 reviewer，所以必須傳遞 `--reviewer` 參數
8. MR description: FE-7838
9. 預設提交 AI review（如需不送審，可用 `--no-review`）
10. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

**範例 5-1: 用戶輸入 `cr multiple-ticket 請讓 @john.doe 審查，同時修復了 IN-1235`（使用智能偵測功能）**
```
1. 檢查 git 狀態 → 發現變更
2. **驗證多 ticket 要求**：偵測到 IN-1235 → 驗證通過
3. 自動從上下文推斷 commit 信息
4. 執行: pnpm run agent-commit --type=feat --ticket=FE-7838 --message="..." --auto-push
5. **智能偵測到文字描述中的 reviewer: @john.doe**
6. 詢問用戶：偵測到文字描述中提到了 reviewer：@john.doe，是否要將此用戶設置為 --reviewer 參數？
   選項：1. 是，使用 @john.doe 作為 reviewer  2. 否，不使用 reviewer 參數
7. 用戶選擇：1（是）
8. **因為用戶明確指定了 reviewer** → 執行: pnpm run create-mr --reviewer="@john.doe" --related-tickets="IN-1235"
9. MR description: FE-7838 , IN-1235
10. 預設提交 AI review（如需不送審，可用 `--no-review`）
13. 在 chat 中提供格式化的執行結果（包含 Commit 資訊、MR 資訊、變更內容）
```

## 建立 MR 的認證方式

腳本支持兩種認證方式，按優先順序：

1. **GitLab CLI (glab) - 推薦**
   - 使用用戶的 GitLab 帳號權限
   - 需要先執行: `glab auth login --hostname gitlab.service-hub.tech`
   - 無需手動設置 token
   - 更安全，使用 OAuth 授權

2. **API Token**
   - 需要設置環境變數: `export GITLAB_TOKEN="your-token"`
   - 或 git config: `git config --global gitlab.token <your-token>`
   - 獲取 token: https://gitlab.service-hub.tech/-/user_settings/personal_access_tokens

## 注意事項

- ⚠️ 如果 commitlint 驗證失敗，必須重新獲取正確的信息
- ⚠️ 確保 commit message 符合專案規範
- ⚠️ 在 main/master/develop 分支上操作時要特別小心
- ✅ 優先使用 `agent-commit` 腳本，它會自動處理所有驗證和流程
- ✅ 如果用戶明確要求自動執行，使用 `--auto-push` 參數
- ✅ 建立 MR 時，優先使用 `create-mr` 腳本，它會自動選擇最佳認證方式
- ✅ MR 預設為 Draft 狀態，reviewer 預設為 "@william.chiang"（支持 @ 符號格式）

## 快速執行模板

### Commit 模板

當獲取到所有信息後，使用以下模板：

```bash
pnpm run agent-commit \
  --type={推斷或獲取的 type} \
  --ticket={推斷或獲取的 ticket} \
  --message="{推斷或獲取的 message}" \
  --auto-push
```

### 建立 MR 模板

Commit 並推送完成後，建立 MR：

```bash
pnpm run create-mr \
  --labels="{labels 用逗號分隔，例：4.0UI,Static File}" \
  --reviewer="@william.chiang" \
  --target=main
```

### 完整流程模板（Commit + MR）

如果用戶要求同時 commit 和建立 MR：

```bash
# 1. Commit 並推送
pnpm run agent-commit \
  --type={type} \
  --ticket={ticket} \
  --message="{message}" \
  --auto-push

# 2. 建立 MR
pnpm run create-mr \
  --labels="{labels 用逗號分隔，例：4.0UI,Static File}" \
  --reviewer="@william.chiang" \
  --target=main
```

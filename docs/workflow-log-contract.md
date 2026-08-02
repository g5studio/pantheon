# Workflow Log 資料契約（OL-6）— 五維分析對照

> **位置**：repo 根目錄 `docs/`（與 Cursor 掛載目錄 `.cursor/` 分離）。

Pantheon Operator 結尾送出的 `logScope=workflow` agent log，供 Ares Prometheus Pilot Capability Dashboard 計算五維能力。

**原則**：腳本保證優先於 Agent 手動 `--data`；推不出 ticket 時標 `ticketSource=none`，不可假裝有項目鍵。

## 啟用條件

- 既有 `MASTER_CONTROL_AGENT_API_URL`（未設定則 skip，不阻斷主流程）
- **不新增**額外 env

## 五維 vs 欄位

| 維度 | Ares 主要依賴 | Pantheon 腳本保證 | Agent 仍可能影響 |
|---|---|---|---|
| 速度力 | `durationMs` + `ticket`／`mrUrl` | timing：`startedAt`→`implementation-confirmed`（`endedAt`）；缺事件才 fallback 送 log；ticket／mrUrl 自動推導 + `ticketSource` | 顯式 `--data`／`--duration-ms` 覆寫 |
| 爆發力 | 時間區間重疊（`startedAt`+`durationMs`） | 活躍開發起迄（不含 commit／MR 等待） | `AGENT_DISPLAY_NAME`（分組，若 Ares 啟用） |
| 決策力 | `planMetrics.revisionCount` | 有 plan events 則彙整；**無則 `planMetrics.missing=true`** | 是否打 `plan-initial`／`plan-revision` |
| 穩定度 | 穩定並行平均 | session timing | 身分欄位完整度 |
| 準確度 | 項目鍵（ticket／mrUrl） | 同速度力推導 | 顯式 `--data` |

## ticket 推導優先級

| 優先級 | 來源 | `ticketSource` | confidence |
|---|---|---|---|
| 1 | `--data.ticket` | `explicit` | high |
| 2 | `session.ticket` | `session` | high |
| 3 | git branch 正則 | `branch` | medium |
| 4 | start-task git notes | `git-notes` | medium |
| 5 | 推不出 | `none` | low |

## mrUrl

| 優先級 | 來源 | `mrUrlSource` |
|---|---|---|
| 1 | `--data.mrUrl` | `explicit` |
| 2 | 目前 branch 的 opened MR（glab，最佳努力） | `branch-mr` |
| 3 | 無 | `none` |

## dataQuality

| 欄位 | 意義 |
|---|---|
| `missingUserEmail` | 缺少 `JIRA_EMAIL` |
| `missingAgentDisplayName` | 缺少 `AGENT_DISPLAY_NAME` |
| `ticketMissing` | 無法推導 ticket |
| `planMetricsMissing` | start-task 且無 plan events（同 `planMetrics.missing`） |

session `start` 與 `send-operator-log` 會對身分缺失印 stderr 警告。

## 用法

```bash
pnpm run operator-session -- --action=start --command=start-task --ticket=OL-6
# ... workflow ...
pnpm run send-operator-log -- --action=start-task --reason="mr created"
```

中途補綁：

```bash
pnpm run operator-session -- --action=set --ticket=OL-6
```

## Workflow timing（OL-53）

| 欄位 | 說明 |
|---|---|
| `startedAt` | `operator-session --action=start` |
| `endedAt` | 優先 `implementation-confirmed`（開發完成確認）；缺則 fallback 為送 log 時間 |
| `occurredAt` | `send-operator-log` 執行當下（可晚於 endedAt） |
| `durationMs` | `endedAt − startedAt`（活躍開發時長；**不含** commit／MR／延遲送 log） |
| `endedAtSource` | `session-field`／`implementation-confirmed-event`／`send-log-fallback` |

Agent 必須在 start-task「強制停止點 2：開發完成確認」用戶同意後立即：

```bash
pnpm run operator-session -- --action=event --event-type=implementation-confirmed
```

## collaborationMetrics（OL-53）

`send-operator-log` 會自動 merge `collaborationMetrics`。契約重點：

| 欄位 | 說明 |
|---|---|
| `humanEditDetected` | 人工改碼：以 uncommitted／dirty 差為主；**不以** `commitsDuringSession`／`headChanged` 單獨判定。commit 訊號需同時滿足：(1) 起點 HEAD 仍是終點祖先（切 release／換歷史線則不採信）；(2) committer 時間 ≥ session 起點。AI commit 以 operator session 事件 `type=agent-commit` 的 SHA 辨識（由 operator 流程記錄；**不用** conventional subject 格式） |
| `humanDirectionAdjusted` | 人為調整方向：由 LLM 分析本 session 的 `user-prompt` 紀錄判定（**非** hardcode `plan-revision`／`requestChange`） |
| `directionSignals` | LLM 結果細節：`reason`／`confidence`／`source`（`llm`｜`fallback`）／`promptCount` |
| `collaborationOutcome` | **無人工介入**（無手改且無改方向）→ 一律 `ai-only`；有介入 → `mixed`／`human-primary`。**不拆** `guided-ai` |

### 已移除／不相容

| 舊欄位／行為 | 狀態 |
|---|---|
| `aiCompleted` | **已移除**（不再作為 outcome 輸入；session `ai-completed` event 已刪除） |
| `guided-ai` outcome | **不採用**（無介入一律 `ai-only`） |
| hardcode 改方向（僅看 `plan-revision`／`requestChange`） | **不採用**（改 LLM 分析 prompt） |

### Prompt 紀錄來源

Hook `prompt-event-collector` 在 operator session 作用中時，會把 user prompt 寫入 session event（`type=user-prompt`）。LLM 失敗時 `humanDirectionAdjusted=false` 且 `directionSignals.source=fallback`，**不阻斷** workflow log。

### Prompt 使用邊界

- Prompt 可作「改方向」／「否定人工改碼」的輔助依據
- Prompt **不得**作為「肯定手改」的唯一依據（手改仍看 git dirty／session 時間窗內且非 `agent-commit` SHA 的 commit）

## 相關

- Feature：[OL-6](https://innotech.atlassian.net/browse/OL-6)
- Collaboration 判定修正：[OL-53](https://innotech.atlassian.net/browse/OL-53)
- Epic：[OL-5](https://innotech.atlassian.net/browse/OL-5)
- Prompt Event（非五維 cohort）：[OL-7](https://innotech.atlassian.net/browse/OL-7)
- Prompt Event 文件：[prompt-event.md](./prompt-event.md)
- 發送時機總覽：[agent-log-events.md](./agent-log-events.md)

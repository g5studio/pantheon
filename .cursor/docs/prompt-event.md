# Prompt Event（OL-7）— Phase 2（prometheus：含 operator enrichment）

在 Phase 1（純 Hooks prompt 觀測）之上，於 **prometheus** 分支讀取 `operator-session`，補齊情境欄位。

`logScope` 仍為 `prompt`，**不進入**五維 analysis cohort。

## 啟用條件

1. 設定既有 `MASTER_CONTROL_AGENT_API_URL`（有值即啟用；**不新增**其他 env）
2. 專案有 `.cursor/hooks.json` 註冊 `prompt-event-collector.mjs`

未設定 Log API URL 時 hook 安靜 skip，並 `exit 0`。

## 固定行為（寫死，無額外 env）

| 項目 | 值 | 說明 |
|---|---|---|
| 啟用 | 跟隨 Log API | 等同 `isAgentLogEnabled()` |
| 隱私模式 | `preview-hash` | 送 `promptPreview` + `promptHash` + `promptLength` |
| preview 長度 | `200` | 超長截斷並加 `…` |
| assistant | 開啟 | `afterAgentResponse` 一併送出 |
| scope | `all` | freeform 與 operator 皆送 |
| operator enrichment | 開啟 | 讀取 `operator-session` 補情境欄位 |

## 相對 Phase 1 新增

| 欄位 | 說明 |
|---|---|
| `interactionKind` | `operator` / `freeform` |
| `operatorSessionActive` | bool |
| `operatorAction` | 如 `start-task` |
| `sessionId` | `{action}@{workflowStartedAt}` |
| `promptIndexInSession` | 該 operator session 內序號 |
| `timeSinceSessionStartMs` | 距 session start |
| `ticketSource=session` | 若 session 帶 ticket |

## 手動 dry-run

```bash
pnpm run operator-session -- --action=start --command=start-task
printf '%s' '{"prompt":"continue","conversation_id":"c1","generation_id":"g1"}' \
  | node .cursor/hooks/prompt-event-collector.mjs --event=beforeSubmitPrompt --dry-run
```

## 相關

- Feature：[OL-7](https://innotech.atlassian.net/browse/OL-7)
- Phase 1（main 零額外 env）：[MR !71](https://gitlab.service-hub.tech/frontend/pantheon/-/merge_requests/71)

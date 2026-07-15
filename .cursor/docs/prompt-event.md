# Prompt Event（OL-7）— Phase 1（不依賴 operator）

User Prompt / Assistant 往來觀測：經 Cursor Hooks 送出 `logScope=prompt` 的 agent log 至 Ares。

**不進入** Prometheus 五維 analysis cohort（僅 `logScope=workflow` 計分）。  
**本階段不含** `operator-session` / `interactionKind` / `operatorAction`（見後續 prometheus enrichment）。

## 啟用條件

1. 設定 `MASTER_CONTROL_AGENT_API_URL`（或顯式 `PROMPT_EVENT_ENABLED=true`）
2. 專案有 `.cursor/hooks.json` 註冊 `prompt-event-collector.mjs`

## Env

| 變數 | 預設 | 說明 |
|---|---|---|
| `PROMPT_EVENT_ENABLED` | 跟隨 Log API | 未設則有 API URL 即啟用 |
| `PROMPT_EVENT_PRIVACY_MODE` | `preview-hash` | `preview-hash` \| `hash-only` \| `full` |
| `PROMPT_EVENT_PREVIEW_CHARS` | `200` | preview 長度 |
| `PROMPT_EVENT_ASSISTANT_ENABLED` | `true` | 是否送 `afterAgentResponse` |
| `PROMPT_EVENT_DEBUG` | `0` | hook stderr 除錯 |

## 主要欄位

| 欄位 | 準確度 | 說明 |
|---|---|---|
| `eventType` | 腳本保證 | `user-prompt` / `assistant-event` |
| `promptHash` / `promptLength` | 腳本保證 | 一律有 |
| `promptPreview` / `promptText` | 依隱私模式 | 預設只有 preview |
| `conversationId` / `generationId` | hook 保證 | Cursor hook base schema |
| `attachments` | hook 保證 | 附檔清單 |
| `ticket` + `ticketSource` | 推導 | `branch` → `prompt-regex` → `none` |
| `ticketConfidence` | 腳本保證 | medium / low |
| `promptIndexInConversation` | 腳本保證 | 同 conversation 序號 |

## 手動 dry-run

```bash
printf '%s' '{"prompt":"hello OL-7","conversation_id":"c1","generation_id":"g1","model":"test"}' \
  | node .cursor/hooks/prompt-event-collector.mjs --event=beforeSubmitPrompt --dry-run
```

## 相關單

- Feature：[OL-7](https://innotech.atlassian.net/browse/OL-7)
- Epic：[OL-5](https://innotech.atlassian.net/browse/OL-5)

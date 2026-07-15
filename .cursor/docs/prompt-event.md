# Prompt Event（OL-7）— Phase 1（不依賴 operator）

User Prompt / Assistant 往來觀測：經 Cursor Hooks 送出 `logScope=prompt` 的 agent log 至 Ares。

**不進入** Prometheus 五維 analysis cohort（僅 `logScope=workflow` 計分）。  
**本階段不含** `operator-session` / `interactionKind` / `operatorAction`（見後續 prometheus enrichment）。

## 啟用條件

1. 設定既有 `MASTER_CONTROL_AGENT_API_URL`（有值即啟用；**不新增**其他 env）
2. 專案有 `.cursor/hooks.json` 註冊 `prompt-event-collector.mjs`

未設定 Log API URL 時 hook 安靜 skip，並 `exit 0`（不影響 Cursor）。

## 固定行為（寫死，無額外 env）

| 項目 | 值 | 說明 |
|---|---|---|
| 啟用 | 跟隨 Log API | 等同 `isAgentLogEnabled()` |
| 隱私模式 | `preview-hash` | 送 `promptPreview` + `promptHash` + `promptLength` |
| preview 長度 | `200` | 超長截斷並加 `…` |
| assistant | 開啟 | `afterAgentResponse` 一併送出 |

## 主要欄位

| 欄位 | 準確度 | 說明 |
|---|---|---|
| `eventType` | 腳本保證 | `user-prompt` / `assistant-event` |
| `promptHash` / `promptLength` | 腳本保證 | 一律有 |
| `promptPreview` | 腳本保證 | 預設 privacy 下有；不含全文 |
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

# Workflow Log 資料契約（OL-6）— 五維分析對照

Pantheon Operator 結尾送出的 `logScope=workflow` agent log，供 Ares Prometheus Pilot Capability Dashboard 計算五維能力。

**原則**：腳本保證優先於 Agent 手動 `--data`；推不出 ticket 時標 `ticketSource=none`，不可假裝有項目鍵。

## 啟用條件

- 既有 `MASTER_CONTROL_AGENT_API_URL`（未設定則 skip，不阻斷主流程）
- **不新增**額外 env

## 五維 vs 欄位

| 維度 | Ares 主要依賴 | Pantheon 腳本保證 | Agent 仍可能影響 |
|---|---|---|---|
| 速度力 | `durationMs` + `ticket`／`mrUrl` | timing（session）；ticket／mrUrl 自動推導 + `ticketSource` | 顯式 `--data` 覆寫值 |
| 爆發力 | 時間區間重疊（`startedAt`+`durationMs`） | session 起迄 | `AGENT_DISPLAY_NAME`（分組，若 Ares 啟用） |
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

## 相關

- Feature：[OL-6](https://innotech.atlassian.net/browse/OL-6)
- Epic：[OL-5](https://innotech.atlassian.net/browse/OL-5)
- Prompt Event（非五維 cohort）：[OL-7](https://innotech.atlassian.net/browse/OL-7)

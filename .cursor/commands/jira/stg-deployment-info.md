# stg-deployment-info

查詢 STG 部署資訊，從 Jira filter 15608 取得所有 issues，按類型分類產生報告。

## 功能說明

- 從 Jira filter 15608 取得所有 issues
- 依照 issue 的 type 分類：
  - **Request** 類型 → 顯示為「功能釋出」
  - **Bug** 類型 → 顯示為「問題修復」
- 產生 Markdown 格式的報告，在 chat 中顯示

## 報告格式範例

```
> 生成時間：2024-11-11 15:30:00
> Filter: [點擊此處在 Jira 中查看 filter](https://innotech.atlassian.net/issues/?filter=15608)

## 功能釋出：

https://innotech.atlassian.net/browse/IN-101498
https://innotech.atlassian.net/browse/IN-100700
https://innotech.atlassian.net/browse/FE-7838

## 問題修復：

https://innotech.atlassian.net/browse/IN-101732
https://innotech.atlassian.net/browse/IN-101589
```

## 使用方式

當用戶執行 `stg-deployment-info` 命令時：

1. 執行 `.cursor/scripts/jira/stg-deployment-info.mjs` 腳本
2. 腳本會自動：
   - 連線到 Jira（使用 `.env.local` 中的配置）
   - 取得 filter 15608 的所有 issues
   - 按 issue type 分類（Request → 功能釋出，Bug → 問題修復）
   - 在 console 中顯示報告

## 執行腳本

```bash
node .cursor/scripts/jira/stg-deployment-info.mjs
```

## 配置要求

需要在 `.env.local` 中設置 Jira 配置：

```
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

## 注意事項

- 報告中的單號連結會以 URL 格式呈現
- 報告會在 chat 中直接顯示，不會存檔
- 所有產出的報告都會包含生成時間資訊


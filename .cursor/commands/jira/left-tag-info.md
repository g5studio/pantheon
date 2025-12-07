# left-tag-info

在指定的 Jira task 中添加 tag 超連結評論。

## 功能說明

1. **請用戶提供 jira task 清單**：支援多種格式（逗號分隔、空格分隔或換行分隔）
2. **請用戶提供 tag 與對應的 tag url**：每行一個對應，格式為 `tag:url` 或 `tag=url`
3. **依序到 jira task 中以超連結留言 tag**：為每個 task 添加包含 tag 超連結的評論

## 使用範例

### Tag 與 URL 對應範例

```
release-5.34.24:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24
release-5.34.25:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.25
```

點擊 `release-5.34.24` 的超連結後會前往 `https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24`

## 使用方式

當用戶執行 `left-tag-info` 命令時：

1. **互動式詢問**：
   - 輸入 Jira task 清單（例如：IN-123, FE-456, IN-789）
   - 輸入 tag 與 URL 對應（每行一個，格式：tag:url）
2. 執行 `.cursor/scripts/jira/left-tag-info.mjs` 腳本
3. 腳本會自動：
   - 連線到 Jira（使用 `.env.local` 中的配置）
   - 解析 task 清單和 tag 對應
   - **驗證 tag 與 URL 的對應關係**（檢查 URL 格式和 tag 名稱是否匹配）
   - 如果發現 tag 與 URL 不匹配，**顯示錯誤訊息並停止**
   - 依序為每個 task 添加包含 tag 超連結的評論
   - 顯示操作結果摘要

## 執行腳本

### 互動式模式

```bash
node .cursor/scripts/jira/left-tag-info.mjs
```

### 命令行模式

```bash
# 使用 URL
node .cursor/scripts/jira/left-tag-info.mjs \
  --task-url "https://innotech.atlassian.net/browse/IN-100005" \
  --tag-url "https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/sit-5.35.0-z"

# 使用直接參數
node .cursor/scripts/jira/left-tag-info.mjs \
  --tasks "IN-100005, FE-1234" \
  --tags "release-5.34.24:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24" \
  --yes
```

## 配置要求

需要在 `.env.local` 中設置 Jira 配置：

```
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

## 輸入格式

### Task 清單格式

支援以下格式：
- **逗號分隔**：`IN-123, FE-456, IN-789`
- **空格分隔**：`IN-123 FE-456 IN-789`
- **換行分隔**：每行一個 task key

### Tag 與 URL 對應格式

支援以下格式：
- **冒號分隔**：`tag:url`
- **等號分隔**：`tag=url`

每行一個對應，例如：
```
release-5.34.24:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24
release-5.34.25:https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.25
```

## 評論格式

在 Jira 中，評論使用 Jira 標記語言，超連結格式為：`[text|url]`

例如，tag `release-5.34.24` 和 URL `https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24` 會生成：
```
[release-5.34.24|https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/release-5.34.24]
```

## Tag 驗證功能

腳本會自動驗證 tag 與 URL 的對應關係：

1. **URL 格式驗證**：檢查 URL 是否為有效格式
2. **Tag 名稱匹配驗證**：檢查 URL 中是否包含 tag 名稱（不區分大小寫）

如果驗證失敗，腳本會顯示錯誤訊息並停止執行。

## 命令行參數

| 參數 | 說明 | 範例 |
|---|---|---|
| `--task-url` | Jira task URL | `--task-url "https://innotech.atlassian.net/browse/IN-100005"` |
| `--tag-url` | GitLab tag URL | `--tag-url "https://gitlab.service-hub.tech/frontend/fluid-two/-/tags/sit-5.35.0-z"` |
| `--tasks` | Task 清單（逗號、空格或換行分隔） | `--tasks "IN-100005, FE-1234"` |
| `--tags` | Tag 與 URL 對應（換行分隔） | `--tags "tag:url"` |
| `--yes`, `-y` | 跳過確認提示，直接執行 | `--yes` |
| `--help`, `-h` | 顯示幫助信息 | `--help` |

## 注意事項

- 腳本會為每個 task 的每個 tag 添加一個獨立的評論
- 如果某個 task 添加評論失敗，會顯示錯誤訊息但繼續處理其他 task
- 操作前會顯示確認提示，需要輸入 `y` 才會執行（除非使用 `--yes` 參數）
- 所有操作都會顯示成功/失敗的統計資訊


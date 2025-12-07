---
description: 將 pantheon 的 .cursor 內容同步到專案中，自動建立符號連結
---

# Oracle - Pantheon Cursor 同步指令

此指令會自動將 `.pantheon/.cursor` 的內容透過符號連結同步到專案的 `.cursor` 目錄中。

## 執行流程

當用戶輸入 `oracle` 時，執行以下步驟：

### 1. 檢查 .pantheon submodule 是否存在

```bash
if [ -d ".pantheon/.cursor" ]; then
  echo "✅ .pantheon submodule 存在"
else
  echo "❌ 找不到 .pantheon submodule，請先執行: git submodule update --init"
  exit 1
fi
```

如果 `.pantheon/.cursor` 不存在，提示用戶執行 `git submodule update --init` 並結束流程。

### 2. 檢查是否已建立過連結，若是則拉取最新內容

檢查 prometheus 符號連結是否已存在，若已存在表示先前已設置過，則根據專案 submodule 定義的 branch 拉取最新內容：

```bash
if [ -L ".cursor/commands/prometheus" ] || [ -L ".cursor/rules/prometheus" ] || [ -L ".cursor/scripts/prometheus" ]; then
  echo "🔄 偵測到已建立的連結，正在拉取 pantheon 最新內容..."
  cd .pantheon
  git fetch origin
  git pull origin $(git rev-parse --abbrev-ref HEAD)
  cd ..
  echo "✅ pantheon 已更新至最新"
fi
```

### 3. 建立 .cursor 目錄結構

建立以下目錄（如果不存在）：
- `.cursor/commands/`
- `.cursor/rules/`
- `.cursor/scripts/`

```bash
mkdir -p .cursor/commands .cursor/rules .cursor/scripts
```

### 4. 建立 prometheus 符號連結

在每個目錄中建立 `prometheus` 符號連結，指向 `.pantheon/.cursor` 對應的目錄：

```bash
# 如果 prometheus 連結已存在，先移除
rm -f .cursor/commands/prometheus .cursor/rules/prometheus .cursor/scripts/prometheus

# 建立新的符號連結
ln -s ../../.pantheon/.cursor/commands .cursor/commands/prometheus
ln -s ../../.pantheon/.cursor/rules .cursor/rules/prometheus
ln -s ../../.pantheon/.cursor/scripts .cursor/scripts/prometheus
```

### 5. 驗證符號連結

確認符號連結正確指向目標：

```bash
ls -la .cursor/commands/prometheus
ls -la .cursor/rules/prometheus
ls -la .cursor/scripts/prometheus
```

### 6. 檢查並建立環境變數配置檔

檢查 `.cursor/.env.local` 是否存在，若不存在則以 pantheon 的 `.env.example` 為模板建立：

```bash
if [ ! -f ".cursor/.env.local" ]; then
  echo "📝 建立環境變數配置檔..."
  cp .pantheon/.cursor/.env.example .cursor/.env.local
  echo "⚠️ 已建立 .cursor/.env.local，請編輯此檔案填入實際配置值"
  ENV_CREATED=true
else
  echo "✅ .cursor/.env.local 已存在"
  ENV_CREATED=false
fi
```

若新建立了 `.env.local`，在最終輸出時提示用戶完善配置。

### 7. 輸出結果

顯示同步結果摘要：

```
✅ Pantheon Cursor 同步完成！

目錄結構：
.cursor/
├── commands/
│   └── prometheus/ -> ../../.pantheon/.cursor/commands
├── rules/
│   └── prometheus/ -> ../../.pantheon/.cursor/rules
└── scripts/
    └── prometheus/ -> ../../.pantheon/.cursor/scripts

可用的 Prometheus 指令：
- commands/prometheus/cr/
- commands/prometheus/utilities/
- commands/prometheus/agent-operator/
```

## 完整執行腳本

AI 執行時，請使用以下腳本：

```bash
#!/bin/bash
set -e

echo "🔮 Oracle - Pantheon Cursor 同步"
echo "================================="

# 1. 檢查 .pantheon submodule
if [ ! -d ".pantheon/.cursor" ]; then
  echo "❌ 找不到 .pantheon submodule"
  echo "請先執行: git submodule update --init"
  exit 1
fi
echo "✅ .pantheon submodule 存在"

# 2. 檢查是否已建立過連結，若是則拉取最新內容
if [ -L ".cursor/commands/prometheus" ] || [ -L ".cursor/rules/prometheus" ] || [ -L ".cursor/scripts/prometheus" ]; then
  echo "🔄 偵測到已建立的連結，正在拉取 pantheon 最新內容..."
  cd .pantheon
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "   分支: $CURRENT_BRANCH"
  git fetch origin
  git pull origin "$CURRENT_BRANCH"
  cd ..
  echo "✅ pantheon 已更新至最新"
fi

# 3. 建立目錄結構
echo "📁 建立 .cursor 目錄結構..."
mkdir -p .cursor/commands .cursor/rules .cursor/scripts

# 4. 移除舊的符號連結（如果存在）
rm -f .cursor/commands/prometheus .cursor/rules/prometheus .cursor/scripts/prometheus

# 5. 建立新的符號連結
echo "🔗 建立 prometheus 符號連結..."
ln -s ../../.pantheon/.cursor/commands .cursor/commands/prometheus
ln -s ../../.pantheon/.cursor/rules .cursor/rules/prometheus
ln -s ../../.pantheon/.cursor/scripts .cursor/scripts/prometheus

# 6. 檢查並建立環境變數配置檔
ENV_CREATED=false
if [ ! -f ".cursor/.env.local" ]; then
  echo "📝 建立環境變數配置檔..."
  cp .pantheon/.cursor/.env.example .cursor/.env.local
  ENV_CREATED=true
else
  echo "✅ .cursor/.env.local 已存在"
fi

# 7. 驗證並輸出結果
echo ""
echo "✅ 同步完成！"
echo ""
echo "目錄結構："
echo ".cursor/"
echo "├── commands/"
echo "│   └── prometheus/ -> .pantheon/.cursor/commands"
echo "├── rules/"
echo "│   └── prometheus/ -> .pantheon/.cursor/rules"
echo "├── scripts/"
echo "│   └── prometheus/ -> .pantheon/.cursor/scripts"
echo "└── .env.local"
echo ""
echo "可用的指令："
ls .cursor/commands/prometheus/ 2>/dev/null || echo "(無法列出)"

# 若有新建 .env.local，提示用戶配置
if [ "$ENV_CREATED" = true ]; then
  echo ""
  echo "=========================================="
  echo "⚠️  環境變數配置提醒"
  echo "=========================================="
  echo "已建立 .cursor/.env.local，請編輯此檔案填入以下配置："
  echo ""
  echo "必要配置："
  echo "  - JIRA_EMAIL: Jira/Confluence 帳號 email"
  echo "  - JIRA_API_TOKEN: Jira API Token"
  echo "  - GITLAB_TOKEN: GitLab Personal Access Token"
  echo ""
  echo "選填配置："
  echo "  - MR_REVIEWER: 預設 MR Reviewer"
  echo "  - COMPASS_API_TOKEN: Compass API Token"
  echo ""
fi
```

## 使用範例

**範例 1: 首次設置專案**
```
用戶: oracle

AI:
1. 檢查 .pantheon submodule → 存在
2. 未偵測到既有連結，跳過拉取
3. 建立 .cursor/commands, .cursor/rules, .cursor/scripts 目錄
4. 建立 prometheus 符號連結
5. .env.local 不存在，建立模板檔案
6. 輸出結果，並提示用戶完善 .env.local 配置
```

**範例 2: 重新同步（已建立過連結）**
```
用戶: oracle

AI:
1. 檢查 .pantheon submodule → 存在
2. 偵測到已建立的連結，根據 submodule 定義的 branch 拉取最新內容
3. 目錄已存在，跳過建立
4. 移除舊的符號連結，建立新的
5. .env.local 已存在，跳過建立
6. 輸出結果
```

**範例 3: 更新 pantheon 內容**
```
用戶: oracle

AI:
1. 檢查 .pantheon submodule → 存在
2. 偵測到已建立的連結
   - 進入 .pantheon 目錄
   - 取得當前分支（如 main 或 develop）
   - 執行 git fetch origin && git pull origin <branch>
   - pantheon 已更新至最新
3. 重新建立符號連結
4. 檢查 .env.local（已存在則跳過）
5. 輸出結果
```

## 注意事項

- ⚠️ 此指令需要專案已經包含 `.pantheon` submodule
- ⚠️ 如果 `.cursor/commands/prometheus` 等已存在且不是符號連結，請先手動移除
- ✅ 此指令可重複執行，會自動更新符號連結
- ✅ 不會影響 `.cursor` 目錄中的其他檔案（如專案特有的腳本）
- ✅ `.env.local` 只會在不存在時建立，不會覆蓋既有配置
- ⚠️ 首次設置後請務必編輯 `.cursor/.env.local` 填入實際配置值


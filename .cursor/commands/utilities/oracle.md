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

### 2. 建立 .cursor 目錄結構

建立以下目錄（如果不存在）：
- `.cursor/commands/`
- `.cursor/rules/`
- `.cursor/scripts/`

```bash
mkdir -p .cursor/commands .cursor/rules .cursor/scripts
```

### 3. 建立 prometheus 符號連結

在每個目錄中建立 `prometheus` 符號連結，指向 `.pantheon/.cursor` 對應的目錄：

```bash
# 如果 prometheus 連結已存在，先移除
rm -f .cursor/commands/prometheus .cursor/rules/prometheus .cursor/scripts/prometheus

# 建立新的符號連結
ln -s ../../.pantheon/.cursor/commands .cursor/commands/prometheus
ln -s ../../.pantheon/.cursor/rules .cursor/rules/prometheus
ln -s ../../.pantheon/.cursor/scripts .cursor/scripts/prometheus
```

### 4. 驗證符號連結

確認符號連結正確指向目標：

```bash
ls -la .cursor/commands/prometheus
ls -la .cursor/rules/prometheus
ls -la .cursor/scripts/prometheus
```

### 5. 輸出結果

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

# 2. 建立目錄結構
echo "📁 建立 .cursor 目錄結構..."
mkdir -p .cursor/commands .cursor/rules .cursor/scripts

# 3. 移除舊的符號連結（如果存在）
rm -f .cursor/commands/prometheus .cursor/rules/prometheus .cursor/scripts/prometheus

# 4. 建立新的符號連結
echo "🔗 建立 prometheus 符號連結..."
ln -s ../../.pantheon/.cursor/commands .cursor/commands/prometheus
ln -s ../../.pantheon/.cursor/rules .cursor/rules/prometheus
ln -s ../../.pantheon/.cursor/scripts .cursor/scripts/prometheus

# 5. 驗證
echo ""
echo "✅ 同步完成！"
echo ""
echo "目錄結構："
echo ".cursor/"
echo "├── commands/"
echo "│   └── prometheus/ -> .pantheon/.cursor/commands"
echo "├── rules/"
echo "│   └── prometheus/ -> .pantheon/.cursor/rules"
echo "└── scripts/"
echo "    └── prometheus/ -> .pantheon/.cursor/scripts"
echo ""
echo "可用的指令："
ls .cursor/commands/prometheus/ 2>/dev/null || echo "(無法列出)"
```

## 使用範例

**範例 1: 首次設置專案**
```
用戶: oracle

AI:
1. 檢查 .pantheon submodule → 存在
2. 建立 .cursor/commands, .cursor/rules, .cursor/scripts 目錄
3. 建立 prometheus 符號連結
4. 輸出結果
```

**範例 2: 重新同步**
```
用戶: oracle

AI:
1. 檢查 .pantheon submodule → 存在
2. 目錄已存在，跳過建立
3. 移除舊的符號連結，建立新的
4. 輸出結果
```

## 注意事項

- ⚠️ 此指令需要專案已經包含 `.pantheon` submodule
- ⚠️ 如果 `.cursor/commands/prometheus` 等已存在且不是符號連結，請先手動移除
- ✅ 此指令可重複執行，會自動更新符號連結
- ✅ 不會影響 `.cursor` 目錄中的其他檔案（如專案特有的腳本）


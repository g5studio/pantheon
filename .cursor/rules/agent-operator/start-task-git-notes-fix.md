# Start-Task Git Notes 漏洞分析與修復建議

## 問題描述

當使用 `start-task` 創建 feature branch 並進行 commit 後，Git notes 沒有正確關聯到新的 commit，導致 `create-mr.mjs` 無法讀取到 start-task 信息，無法自動添加 AI label 和開發計劃。

## 根本原因

1. **Git notes 保存時機問題**：
   - `start-task.mjs` 在確認計劃時，將 Git notes 保存到當時的 HEAD（通常是 main 分支的 commit）
   - 創建 feature branch 後，HEAD 指向新的分支，但 Git notes 仍然關聯在舊的 commit 上
   - 當在 feature branch 上進行 commit 後，新的 commit 沒有 Git notes

2. **`agent-commit.mjs` 缺少 Git notes 處理**：
   - `agent-commit.mjs` 在 commit 之後沒有檢查或複製 Git notes 到新的 commit
   - 這導致 `create-mr.mjs` 讀取 Git notes 時找不到（因為它讀取的是 HEAD，而 HEAD 現在指向新 commit，但 Git notes 還在舊 commit 上）

3. **`create-mr.mjs` 讀取邏輯不夠健壯**：
   - `readStartTaskInfo()` 只讀取當前 HEAD 的 Git notes
   - 如果當前 commit 沒有 Git notes，不會嘗試從父 commit 或分支的 base commit 讀取

## 漏洞位置

### 1. `start-task-jira-check.mdc` 規則

**問題**：規則中沒有明確說明需要在 commit 之後將 Git notes 複製到新 commit。

**位置**：第 210-218 行

**建議**：添加說明，要求在 commit 之後檢查並複製 Git notes。

### 2. `agent-commit.mjs` 腳本

**問題**：commit 之後沒有處理 Git notes 的複製。

**位置**：第 90-98 行（commit 之後）

**建議**：在 commit 之後添加邏輯，檢查是否有 start-task 的 Git notes 在父 commit 或分支的 base commit 上，如果有則複製到新 commit。

### 3. `create-mr.mjs` 腳本

**問題**：`readStartTaskInfo()` 只讀取當前 HEAD 的 Git notes，不夠健壯。

**位置**：第 1157-1170 行

**建議**：如果當前 commit 沒有 Git notes，嘗試從以下位置讀取：
- 父 commit
- 分支的 base commit（與 main 分支的分叉點）
- 當前分支的第一個 commit

## 修復方案

### 方案 1：在 `agent-commit.mjs` 中複製 Git notes（推薦）

在 commit 之後，檢查是否有 start-task 的 Git notes 在父 commit 或分支的 base commit 上，如果有則複製到新 commit。

```javascript
// 在 commit 之後添加
// 檢查並複製 start-task Git notes 到新 commit
try {
  const currentCommit = exec('git rev-parse HEAD', { silent: true }).trim();
  const parentCommit = exec('git rev-parse HEAD^', { silent: true }).trim();
  
  // 嘗試從父 commit 讀取 Git notes
  try {
    const parentNote = exec(`git notes --ref=start-task show ${parentCommit}`, { silent: true }).trim();
    if (parentNote) {
      // 複製到當前 commit
      exec(`git notes --ref=start-task add -f -F - ${currentCommit}`, {
        input: parentNote,
        silent: false,
      });
      console.log('✅ 已複製 start-task Git notes 到新 commit\n');
    }
  } catch (error) {
    // 父 commit 沒有 Git notes，嘗試從分支的 base commit 讀取
    try {
      const baseCommit = exec('git merge-base HEAD main', { silent: true }).trim();
      const baseNote = exec(`git notes --ref=start-task show ${baseCommit}`, { silent: true }).trim();
      if (baseNote) {
        exec(`git notes --ref=start-task add -f -F - ${currentCommit}`, {
          input: baseNote,
          silent: false,
        });
        console.log('✅ 已從 base commit 複製 start-task Git notes 到新 commit\n');
      }
    } catch (baseError) {
      // 沒有找到 Git notes，繼續執行
    }
  }
} catch (error) {
  // 忽略錯誤，繼續執行
}
```

### 方案 2：增強 `create-mr.mjs` 的 `readStartTaskInfo()` 函數

如果當前 commit 沒有 Git notes，嘗試從父 commit 或分支的 base commit 讀取。

```javascript
function readStartTaskInfo() {
  try {
    // 首先嘗試讀取當前 HEAD 的 Git notes
    const currentCommit = exec('git rev-parse HEAD', { silent: true }).trim();
    try {
      const noteContent = exec(`git notes --ref=start-task show ${currentCommit}`, { silent: true }).trim();
      if (noteContent) {
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // 當前 commit 沒有 Git notes，繼續嘗試其他位置
    }
    
    // 嘗試從父 commit 讀取
    try {
      const parentCommit = exec('git rev-parse HEAD^', { silent: true }).trim();
      const noteContent = exec(`git notes --ref=start-task show ${parentCommit}`, { silent: true }).trim();
      if (noteContent) {
        // 複製到當前 commit 以便後續使用
        exec(`git notes --ref=start-task add -f -F - ${currentCommit}`, {
          input: noteContent,
          silent: true,
        });
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // 父 commit 沒有 Git notes，繼續嘗試
    }
    
    // 嘗試從分支的 base commit 讀取
    try {
      const baseCommit = exec('git merge-base HEAD main', { silent: true }).trim();
      const noteContent = exec(`git notes --ref=start-task show ${baseCommit}`, { silent: true }).trim();
      if (noteContent) {
        // 複製到當前 commit 以便後續使用
        exec(`git notes --ref=start-task add -f -F - ${currentCommit}`, {
          input: noteContent,
          silent: true,
        });
        return JSON.parse(noteContent);
      }
    } catch (error) {
      // base commit 沒有 Git notes
    }
    
    return null;
  } catch (error) {
    return null;
  }
}
```

### 方案 3：在 `start-task.mjs` 中保存到 feature branch 的第一個 commit

在創建 feature branch 後，立即保存 Git notes 到 feature branch 的 HEAD（此時 HEAD 就是 feature branch 的第一個 commit）。

但這個方案有問題，因為 feature branch 創建時還沒有任何 commit，Git notes 無法保存到不存在的 commit 上。

## 推薦方案

**推薦使用方案 1 + 方案 2 的組合**：
1. 在 `agent-commit.mjs` 中，commit 之後自動複製 Git notes（方案 1）
2. 在 `create-mr.mjs` 中，增強 `readStartTaskInfo()` 函數，作為備用方案（方案 2）

這樣可以確保：
- 正常情況下，Git notes 會在 commit 時自動複製
- 即使複製失敗，`create-mr.mjs` 也能從其他位置讀取到 Git notes

## 規則更新建議

在 `start-task-jira-check.mdc` 中添加以下內容：

### 在 "更新 Git notes 的時機" 部分添加：

```
- **在 commit 之後**：當使用 `agent-commit.mjs` 或類似腳本進行 commit 後，應該檢查並複製 Git notes 到新 commit，確保 `create-mr.mjs` 能夠讀取到 start-task 信息
```

### 在 "實施檢查清單" 部分添加：

```
在 `agent-commit.mjs` 中：
- [ ] 在 commit 之後，檢查並複製 start-task Git notes 到新 commit
- [ ] 如果父 commit 或 base commit 有 Git notes，自動複製到當前 commit

在 `create-mr.mjs` 中：
- [x] 檢查 `startTaskInfo` 並自動添加 `AI` label（已實現）
- [x] 檢查 `startTaskInfo` 並添加開發方案到 MR description（已實現）
- [ ] 增強 `readStartTaskInfo()` 函數，如果當前 commit 沒有 Git notes，嘗試從父 commit 或 base commit 讀取
```


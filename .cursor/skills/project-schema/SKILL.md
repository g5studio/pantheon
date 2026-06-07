---
name: project-schema
description: Project module architecture and boundaries for Operator Agent workflows. Use when navigating codebase structure, determining file ownership, or validating changes against module boundaries.
---
<!-- managed-by-pantheon-evolve -->

# Project Schema

此 skill 由 `evolve` 指令的階段一生成。在尚未執行 `evolve` 前，此檔案為佔位模板。

## When To Use

在以下情境讀取此 skill：

1. 需要判斷某檔案屬於哪個模塊
2. 規劃變更時需遵守模塊邊界
3. 審查新檔案是否放在正確目錄
4. 執行 `start-task`、`evolve` 或其他 Operator 工作流

## Status

| 項目 | 狀態 |
|---|---|
| 模塊定義 | 尚未生成 — 請執行 `evolve` 階段一 |
| 最後更新 | - |

## Next Step

```bash
# 1. 確認 adapt.json 已就緒
pnpm run evolve -- check-prereq

# 2. 執行 evolve 指令（由 AI 引導三階段流程）
evolve
```

---

> 此檔案帶有 `managed-by-pantheon-evolve` 標記，`evolve` 可安全更新。若移除標記，後續 `evolve` 將跳過覆蓋以保護自訂內容。

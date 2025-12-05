# Pantheon

## 專案宗旨

Pantheon 專案旨在規範開發流程中所有 Agent Operator 的行為與標準作業程序（SOP）。此專案作為 Agent Operator 的核心規範庫，提供標準化的開發守則、腳本與命令，以便快速部署到其他專案中。

在 AI 大規模協作時代下，我們建立了一套由人類決策者與多個 AI Agent 組成的分層式開發工法。此專案確保所有 Agent Operator 在執行開發任務時，能夠遵循一致的規範與流程，從而提升開發效率與程式碼品質。

## 核心目標

- **標準化 Agent 行為**：制定統一的開發守則與作業規範，確保所有 Agent Operator 遵循相同的標準
- **快速部署能力**：提供可重用的腳本與命令，讓 Agent Operator 能夠快速部署到不同專案
- **流程規範化**：從開發策略到 MR 程序的完整標準化流程
- **品質保證**：透過規範化的流程確保程式碼品質與一致性

## 相關資源

### 開發規範文件

- **[Agent Operator Guideline](https://innotech.atlassian.net/wiki/spaces/Frontend/pages/4078010378/Agent+Operator+Guideline)**：詳細說明新時代多層級 AI 協作開發模式，包含 Commander、Pilot、Operator、Master Controller、Reviewer、Admin 等角色的職責與工作流程

### 相關 Jira Tickets

- **[FE-7892](https://innotech.atlassian.net/browse/FE-7892)**：[AI] 抽出基礎 agent operator script & command 以便快速部署到其他專案
- **[FE-7893](https://innotech.atlassian.net/browse/FE-7893)**：[AI] 制定 agent operator 作業規範與開發守則

## 專案結構

本專案包含以下核心組件：

- **開發守則**：定義 Agent Operator 在開發過程中的行為規範
- **代碼提交守則**：規範 commit 與 MR 建立的標準流程
- **腳本與命令**：可重用的工具腳本，支援快速部署到其他專案
- **規範文件**：完整的 SOP 文件，供 Agent Master Controller 作為檢視標準

## 開發模式

本專案遵循「新時代多層級 AI 協作開發模式」，將開發流程拆分為六大關卡：

1. **任務規劃**：Commander 解讀需求並產出任務簡報
2. **計畫推導**：Pilot 轉化任務簡報為執行計畫
3. **自主開發**：Operator 依照執行計畫完成實質開發
4. **稽核**：Master Controller 檢查開發流程是否符合規範
5. **審核**：Code Reviewer 審核程式碼品質與風險
6. **管控**：Admin 監控整體流程運作

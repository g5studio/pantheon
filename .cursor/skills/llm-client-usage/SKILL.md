---
name: llm-client-usage
description: Standard usage pattern for calling llm-client from Pantheon scripts. Use when adding or refactoring script-level LLM calls in .cursor/scripts.
disable-model-invocation: true
---

# LLM Client Usage

## Purpose

Keep all script-level LLM calls consistent, traceable, and easy to degrade between `openai` and `api-domain` modes.

**CRITICAL**: LLM 連線僅允許 `OPENAI_API_KEY` 與 `CUSTOM_OPENAI_API_URL`。`REVIEWER_AGENT_API_TOKEN` / `COMPASS_API_TOKEN` 僅供 Reviewer Agent 的 AI review jobs API，不得傳入 llm-client。

## Standard Pattern

1. Read env with `loadEnvLocal()`.
2. Resolve model with `resolveLlmModel({ explicitModel, defaultModel })` — **不讀 env**；僅 CLI 參數或內建 default。
3. Prefer `callLlmJson()` so provider selection stays centralized:
   - explicit arg (`--llm-provider`) or `*_LLM_PROVIDER` env when needed
   - default: `openai` when `OPENAI_API_KEY` exists, otherwise `api-domain` (`CUSTOM_OPENAI_API_URL`)
4. Add clear degrade logs when provider is switched (`degradedReason` from `callLlmJson`).

## Minimal Template

```javascript
import { loadEnvLocal } from "../utilities/env-loader.mjs";
import { callLlmJson } from "../client/llm-client.mjs";

const envLocal = loadEnvLocal();
const { result, model, provider, degradedReason } = await callLlmJson({
  action: "my-script",
  envLocal,
  providerEnvKeys: ["MY_SCRIPT_LLM_PROVIDER"],
  defaultModel: "gpt-5.4-nano",
  system,
  input,
  schema,
  schemaName: "my_schema",
});

if (degradedReason) {
  console.log(`⚠️  LLM provider 調整: ${degradedReason}`);
}
```

## Notes

- Prefer `api-domain` when `OPENAI_API_KEY` is unset.
- Do **not** use Reviewer/Compass token or operator-proxy for LLM.
- Keep `temperature` explicit only when model supports custom temperature.
- For long-running batch flows, wrap each file/item call with timeout and continue-on-error reporting.

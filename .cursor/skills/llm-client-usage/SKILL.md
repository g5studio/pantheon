---
name: llm-client-usage
description: Standard usage pattern for calling llm-client from Pantheon scripts. Use when adding or refactoring script-level LLM calls in .cursor/scripts.
disable-model-invocation: true
---

# LLM Client Usage

## Purpose

Keep all script-level LLM calls consistent, traceable, and easy to degrade between `openai` and `api-domain` modes.

## Standard Pattern

1. Read env with `loadEnvLocal()`.
2. Resolve model with `resolveLlmModel({ explicitModel, defaultModel })` — **不讀 env**；僅 CLI 參數或內建 default。
3. Resolve provider with this priority:
   - explicit arg (`--llm-provider`)
   - env (`*_LLM_PROVIDER`)
   - default: `openai` when `OPENAI_API_KEY` exists, otherwise `api-domain`
4. Call `callOpenAiJson(...)` with:
   - `apiKey` only for `openai`
   - `customOpenAiApiUrl` only for `api-domain`
   - `forceCompassProxy: false` unless script explicitly requires Compass proxy
5. Add clear degrade logs when provider is switched.

## Minimal Template

```javascript
const envLocal = loadEnvLocal();
const model = resolveLlmModel({
  explicitModel: args.model ?? null,
  defaultModel: "gpt-5.4-nano",
});

const openaiApiKey = process.env.OPENAI_API_KEY || envLocal.OPENAI_API_KEY || null;
const customOpenAiApiUrl =
  process.env.CUSTOM_OPENAI_API_URL ||
  envLocal.CUSTOM_OPENAI_API_URL ||
  "http://service-hub-ai.balinese-python.ts.net/v1";

let provider = args["llm-provider"] || (openaiApiKey ? "openai" : "api-domain");
if (provider === "openai" && !openaiApiKey) provider = "api-domain";

const output = await callOpenAiJson({
  apiKey: provider === "openai" ? openaiApiKey : null,
  customOpenAiApiUrl: provider === "api-domain" ? customOpenAiApiUrl : null,
  forceCompassProxy: false,
  model,
  system,
  input,
  schema,
  schemaName: "my_schema",
});
```

## Notes

- Prefer `api-domain` over Compass in normal scripts.
- Keep `temperature` explicit only when model supports custom temperature.
- For long-running batch flows, wrap each file/item call with timeout and continue-on-error reporting.

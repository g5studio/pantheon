---
name: external-tool-script-check
description: Single source of truth for external-tool operations. Always prefer project scripts and Pantheon runner before any direct API/web access.
---

# External Tool Script Check

Use this skill before handling requests that create, read, or update Jira tickets, or otherwise interact with GitLab, Confluence, GitHub, Linework, or other external tools.

## Goal

Prefer existing project automation over ad-hoc API calls or web access.

## Mandatory Order

Check support in this exact order:

1. Local project scripts in `package.json`
2. Pantheon-mounted scripts exposed through `run-pantheon-script.mjs`
3. Direct external API or web access only if no suitable script exists

## Trigger Scenarios

Read this skill when the user asks to:

- Create, read, or update a Jira ticket
- Read or update a Confluence page
- Create or update an MR / PR through GitLab or GitHub
- Add external comments, labels, transitions, or workflow actions
- Connect Cursor work with any external service or platform workflow

## Required Checks

Before choosing a tool:

1. Read `package.json` and inspect available scripts.
2. Check whether the repo may use Pantheon-mounted tooling.
3. If Pantheon may be involved, prefer mounted script paths or `run-pantheon-script.mjs`.
4. Only fall back to direct API/web calls when no matching script exists or the script fails.
5. If falling back, explain why script-based execution was not used.
6. Never decide "script not found" by search-only results.

## Common Script Matches

Check for existing scripts such as:

- `create-jira-ticket`
- `read-jira-ticket`
- `read-confluence-page`
- `update-jira`
- `transition-jira-ticket`
- `add-jira-comment`
- `create-mr`
- `update-mr`
- `mr-comment`

Also check whether a generic runner exists:

- `.pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs`
- `.cursor/scripts/utilities/run-pantheon-script.mjs`

## Search Visibility Hard Rule

Do not use Glob/rg results as the only evidence that a Pantheon script does not exist.

When mounted or generated folders are ignored by indexing, search can return 0 while files still exist and are executable by direct path. Therefore:

1. Prefer executing through `run-pantheon-script.mjs` directly.
2. If direct path checks are needed, use existence checks in this order:
   - `.pantheon/.cursor/scripts/...`
   - `.cursor/scripts/...`
   - `.cursor/scripts/<install-name>/...`
   - `.agent/scripts/<install-name>/...` or `.agents/scripts/<install-name>/...`
3. Use direct API/web only after runner + path existence checks fail.

## Decision Flow

1. User requests an external-tool action.
2. Inspect `package.json`.
3. If a matching script exists, use `pnpm run <script> -- <args>`.
4. If no matching script exists, check whether Pantheon provides the capability through `run-pantheon-script.mjs`.
5. If Pantheon provides it, use the Pantheon runner.
6. If neither exists, use direct API/web tools as the final fallback.

Examples:

- Jira read -> `read-jira-ticket`
- Jira create -> `create-jira-ticket`
- Jira update / transition / comment -> `update-jira`, `transition-jira-ticket`, `add-jira-comment`

## External Platform Mapping (Default)

| Platform | Preferred script keywords |
|---|---|
| Jira | `read-jira-ticket`, `create-jira-ticket`, `update-jira`, `transition-jira-ticket`, `add-jira-comment` |
| GitLab / MR | `create-mr`, `update-mr`, `mr-comment` |
| Confluence | `read-confluence-page`, `update-confluence-page` |
| Linework | Check `package.json` and Pantheon runner mapping first; if missing, then fallback to direct integration |

## Pantheon Notes

When Pantheon is mounted, do not assume search results alone are enough to prove a script is absent. Check likely paths directly.

Resolve Pantheon script locations in this order:

1. `.pantheon/.cursor/scripts/...`
2. `.cursor/scripts/...`
3. `.cursor/scripts/<install-name>/...`
4. `.agent/scripts/<install-name>/...`

Treat Pantheon as a local tooling layer unless the repo clearly shows it affects runtime or CI.

## Output Expectation

When reporting what you are doing, make the decision explicit:

- Which project script was found and used
- Or which Pantheon script path / runner was used
- Or why the task had to fall back to direct API/web access

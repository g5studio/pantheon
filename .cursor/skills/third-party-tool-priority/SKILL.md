---
name: third-party-tool-priority
description: Prioritizes Pantheon project scripts before direct external API or web access for third-party operations such as Jira, GitLab, and Linework. Use when user instructions involve reading, creating, updating, or commenting on external platforms.
---

# Third-Party Tool Priority

Apply this skill whenever a command or user request needs to operate on third-party platforms (for example Jira, GitLab, Linework, Confluence, GitHub).

## Goal

Always prefer Pantheon project tooling first, and only use direct API/web access as the final fallback.

## Mandatory Order

1. Read `package.json` scripts and check for an existing command.
2. If script exists, use `pnpm run <script> -- <args>`.
3. If script does not exist, check Pantheon runner:
   - `.pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs`
   - `.cursor/scripts/utilities/run-pantheon-script.mjs`
4. Execute the mapped Pantheon script through the runner.
5. Only if both paths are unavailable, use direct API/web tools and explain the reason.

## Jira Priority Examples

- Add Jira comment:
  - First choice: `pnpm run add-jira-comment -- --ticket=<TICKET> --comment="<MESSAGE>"`
  - Script target: `jira/add-jira-comment.mjs`
  - Do not call Jira API directly before trying this path.

- Read Jira ticket:
  - First choice: `pnpm run read-jira-ticket -- --ticket=<TICKET>`
  - Script target: `jira/read-jira-ticket.mjs`
  - Do not call Jira API directly before trying this path.

## External Platform Mapping (Default)

| Platform | Preferred script keywords |
|---|---|
| Jira | `read-jira-ticket`, `create-jira-ticket`, `update-jira`, `transition-jira-ticket`, `add-jira-comment` |
| GitLab / MR | `create-mr`, `update-mr`, `mr-comment` |
| Confluence | `read-confluence-page`, `update-confluence-page` |
| Linework | Check `package.json` and Pantheon runner mapping first; if missing, then fallback to direct integration |

## Output Requirement

When reporting actions, explicitly state one of the following:

- Which script was found and executed
- Which Pantheon runner path was used
- Why fallback to direct API/web was necessary

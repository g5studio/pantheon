---
name: pantheon-mounted-workflow
description: Explains how Pantheon works when mounted into any project, including path resolution, oracle sync behavior, script execution, and common pitfalls. Use this skill whenever the user invokes a Cursor command so the agent can first verify whether the repo depends on Pantheon-mounted tooling.
---
<!-- managed-by-pantheon-adapt -->

# Pantheon Mounted Workflow

Use this skill whenever the user invokes a Cursor command. Start by checking whether the current project may have Pantheon mounted through `.pantheon/`.

## Trigger Condition

Read this skill before executing a Cursor command so the agent can determine whether the command depends on Pantheon-mounted tooling, synced Cursor assets, or mounted script paths.

## What Pantheon Is

In mounted projects, Pantheon is usually a shared Cursor tooling layer, not the app runtime itself.

Typical responsibilities:

- Shared `.cursor/rules`
- Shared `.cursor/commands`
- Shared `.cursor/scripts`
- Shared local workflow helpers such as MR, Jira, version, or project automation scripts

Do not assume Pantheon affects CI, build output, or production runtime unless the repo clearly shows that.

## First Checks

Before using Pantheon-related behavior:

1. Check whether `.pantheon/.cursor` exists.
2. If it does not exist, treat Pantheon as not mounted yet.
3. Look for `pantheon:descend` and `pantheon:oracle` in `package.json`.
4. Inspect `.pantheon/.cursor/scripts/utilities/oracle.mjs` to understand the sync behavior used by this repo.
5. Check whether the project already has a local bootstrap copy at `.cursor/skills/pantheon-mounted-workflow/SKILL.md`.

## Correct Mental Model

`pantheon:descend` usually does two things:

1. Clone the Pantheon repo into `.pantheon/`
2. Run `oracle.mjs` to sync Cursor assets into the current project

`pantheon:oracle` usually assumes `.pantheon/` already exists and only performs the sync/update step.

`adapt` is the repo-localization step. Its command flow writes `adapt.json` into the project root and then runs `generate-pantheon-guideline.mjs` to materialize bootstrap Pantheon knowledge directly into the target project so the agent can still read it even when mounted paths or symlinks are not discoverable.

Important: some Pantheon setups reset local changes inside `.pantheon/` before pulling updates. Treat `.pantheon/` as an external mounted repo, not a safe place for uncommitted local edits.

## Path Resolution Rules

When running or reading Pantheon-provided files, resolve paths in this order:

1. `.pantheon/.cursor/...`
2. `.cursor/...`
3. `.cursor/scripts/prometheus/...`, `.cursor/rules/prometheus/...`, or `.cursor/commands/prometheus/...` when the repo aggregates via symlink

For this bootstrap skill, prefer the local materialized copy first:

1. `.cursor/skills/pantheon-mounted-workflow/SKILL.md`
2. `.pantheon/.cursor/skills/pantheon-mounted-workflow/SKILL.md`

If the mounted repo includes `run-pantheon-script.mjs`, prefer it when the script path may vary across mounted and non-mounted environments.

## Search Caveat

Do not rely only on search results to conclude a Pantheon file does or does not exist.

Mounted `.pantheon/` directories and symlinked folders can be missed by some search/indexing flows. If the user already gave a likely path, read it directly. If a path is uncertain, check known Pantheon locations in the fallback order above.

## How To Operate Correctly

When the user asks to use Pantheon in a mounted project:

1. Explain Pantheon’s role in this repo: tooling layer vs runtime feature.
2. Identify the mount entry points in `package.json`.
3. Identify what `oracle.mjs` syncs into `.cursor/`.
4. Check whether `adapt.json` exists and treat it as repo-localized Pantheon knowledge.
5. Use Pantheon scripts via the correct mounted path.
6. Mention any safety risks such as local reset behavior inside `.pantheon/`.

When the user asks how this project uses Pantheon, summarize:

- Where Pantheon is mounted
- How it is updated
- Which local scripts or knowledge files depend on it
- Whether it is part of runtime/CI or only local tooling

## Minimum Files To Inspect

When investigating Pantheon usage in an unfamiliar repo, start from:

- `package.json`
- `.gitignore`
- `adapt.json`
- `.pantheon/version.json`
- `.pantheon/.cursor/scripts/utilities/oracle.mjs`
- `.pantheon/.cursor/scripts/utilities/run-pantheon-script.mjs` if present
- Any local `.cursor/scripts/*` that import from a Pantheon symlink path

## Common Mistakes

1. Treating Pantheon as application runtime without evidence
2. Assuming search misses mean the file is absent
3. Using a symlink path first when `.pantheon/.cursor/...` exists
4. Editing `.pantheon/` casually without realizing `oracle` may reset it
5. Ignoring `adapt.json` even though the project already finished repo localization

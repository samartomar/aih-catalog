---
name: install-commit-gate
description: "Install a Git hook to check staged content for conflict markers, debug tags and quality-bar loosening."
disable-model-invocation: true
---

# Install the commit gate

Install this skill's `commit-gate.mjs` as a `commit-msg` hook in the requested
repository. Read the script header for its checks and `VERSION`.

1. **Locate:** resolve `git rev-parse --show-toplevel`, the effective
   `core.hooksPath` and existing `commit-msg` hook. Stop if this is not a Git
   worktree. Identify a shared hooks directory before editing it; repository
   installation does not authorize changing hooks used by other repositories.
2. **Copy:** place the gate at `<root>/.githooks/commit-gate.mjs`. Inspect and
   back up an existing file before upgrading; preserve local customizations.
   The gate excludes itself from scanning.
3. **Wire:** add `node .githooks/commit-gate.mjs "$1"` once to the applicable
   hook, preserving existing commands and valid shell syntax. Keep the invocation
   reachable and propagate its nonzero exit status:
   - Use `.husky/commit-msg` when this repository uses Husky.
   - Otherwise use the effective configured hooks directory.
   - Without either, resolve `git rev-parse --git-path hooks/commit-msg`.
   Create an absent shell hook with `#!/bin/sh` and make it executable. A hook
   in Git's local directory is not shared through commits; `/setup-pre-commit`
   is the separate option for configuring shared Husky hooks.
4. **Verify:** run `node <root>/.githooks/commit-gate.mjs --self-test`, inspect
   the effective hook path and confirm the invocation appears once. Report the
   self-test result separately from hook wiring; it does not exercise a commit.
5. **Report:** name the changed paths and explain that `[floor-ok: <reason>]`
   permits deliberate quality-bar changes and `.floorignore` excludes paths.
   Git's `--no-verify` bypasses hooks; an enabled Extensions git-guard can block
   that agent command. Commit the shared files only when the user asks.

---
"@flow-state-dev/workspace": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/harness-manager": patch
---

A project's repository can be checked before any run. `localWorkspaceHost` answers `checkRepository(repository, { ignored })` without making anything: whether a run's checkout could be made there, and if not, a sentence naming the fix. The ignore rule is read from the last commit, as a run's checkout gets it, so a rule that is only in uncommitted changes is refused with "commit it". `defineProjectBlocks({ checkRepository })` uses it to refuse `createProject` and `setRepository` with `repository-unusable`, and serves a read-only `checkRepository` action a page can ask before Create. `harness-manager` exports `ASK_MARKER_IGNORED`, the rule coding runs need (FIX-2403).

---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": minor
---

A coding run's review opens a changed file's diff in place, with no pull request needed (FIX-2796).

- **harness-manager:** the harness kit's `coder` flow serves the `changes` session view (`harnessRunChangesView`) on each run's session. `runChangesViewRef()` from `@flow-state-dev/harness-manager/browser` addresses it: `client.view(runChangesViewRef(), { path }, { sessionId })` answers one file's patch.
- **shift-manager:** the review card in Inbox, the Shift Coordinator summary and a task's session opens each changed file into its patch, read when the file is opened. A review raised by a flow other than `coder` lists its files without opening them, as before.

Docs: packages/harness-manager/README.md (the coder flow's views, and `runChangesViewRef` in the browser entry)

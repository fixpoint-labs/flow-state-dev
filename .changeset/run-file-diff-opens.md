---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": patch
---

A coding run's review can open each changed file to its diff.

- **The coding worker flow serves the run changes view.** The harness kit's `coder` flow now declares `changes` (`harnessRunChangesView`) beside `recordedWork`, so a screen reads one file's patch in the run's own session: `client.view(runChangesViewRef(), { taskId, path }, { sessionId })`. `runChangesViewRef` and the `HarnessRunChangesView` type are exported from `@flow-state-dev/harness-manager/browser`.
- **A patch read opens only the change's own files.** `readRunFilePatch` (and the changes views of a board run and a session turn) now refuses a path the run's commits didn't change, throwing `RunFileNotChanged`: a file the run never touched, a folder, a glob, or a path outside the checkout. It used to answer an empty patch.
- **A cut patch says how long it is.** A file patch now carries `lines`, the whole patch's line count, counted past the `MAX_PATCH_CHARS` cut.
- **shift-manager's Files list** draws a file's diff with tinted added and removed lines, scrolls long lines inside the diff, says in one line when a file is binary, deleted or renamed, says "Diff too large, N lines" for a cut patch, and "Diff no longer available" when the run's checkout can't be read.

Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (the coder flow's `changes` view, `runChangesViewRef`, the `RunFileNotChanged` refusal and the patch's `lines`)

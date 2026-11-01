---
"@flow-state-dev/harness-manager": minor
---

`@flow-state-dev/harness-manager` reads what a coding run changed (FIX-2384). A `reviewChanges` stop's data carries each changed file and its added and removed lines (`files`, `fileCount`, `added`, `removed`), and its prompt names them. `harnessRunChangesRead({ board, uses })` is a flow read, stored nowhere, that answers a board run's files or one file's patch from the run's own session. `harnessSessionFlow` records each turn's `base` and `head` commits and declares a `changes` read for one turn's files or patch. New exports: `harnessRunChangesRead`, `HarnessRunChangesRefused`, `harnessRunChangesInputSchema`, `harnessRunChangesOutputSchema`, `harnessTurnChangesInputSchema`, `runChangesSchema`, `runDiffSchema`, `runFilePatchSchema`, `MAX_DIFF_FILES`, `MAX_PATCH_CHARS`, and the `RunChanges`, `RunDiff`, `RunDiffFile` and `RunFilePatch` types.

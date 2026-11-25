---
"@flow-state-dev/workforce": patch
---

A `.mts` or `.cts` code file in a workforce folder now stops the app starting, named, instead of starting an app that registers nothing for it (FIX-2914). `fsdev gen` registers `.ts` and `.tsx` only, so such a file was never in `workforce.gen.ts` and no worker could name it. Rename it to `.ts` (or `.tsx`).

Docs: apps/docs/docs/reference/workforce-folder.md ("The kit accepts `.mts` and `.cts` in the same places…" becomes: a `.mts` or `.cts` file in a code position is refused at start-up, by path). When that sentence goes, the two `.mts`/`.cts` rows in packages/workforce/test/published-tree-surface.test.ts (PUBLISHED_SHAPES and PROSE_PUBLISHED) go with it.

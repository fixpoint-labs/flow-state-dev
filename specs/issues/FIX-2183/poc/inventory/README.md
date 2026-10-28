# FIX-2183 · inventory check

**Question.** Is every hold-shaped name the spec retires still live on `main`, and is every
hold-shaped export in the modules it covers either renamed or kept on purpose?

**Run.** `node specs/issues/FIX-2183/poc/inventory/check.mjs` from the repository root. It prints
each retired head name with its file counts (package source / docs and READMEs / the rest) and
exits 1 on a gap. `--control` plants an unclassified export, `plantedHoldThing`, and must exit 1.

**Limits.** The totality check reads the exports of nine modules (listed in the script) and only
names matching `/hold|held|waitingon/i`. Field names (`holds`, `question` on `updateTask`) and
prose are not counted here: the sweep's rows refuse those at build time. The map duplicates the
head names in `specs/epics/FIX-2071/renames.md` on purpose: it is design evidence for this spec,
not a second source of truth, and the implementation's codemod is the one that renames.

**Result on `main` at 78b0b07.** PASS; under `--control`, FAIL (exit 1), as it must.

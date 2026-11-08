# Retired-name census

Throwaway design evidence for this spec. Not production code; not run by CI.

**Question.** For each retired name the source still refuses or reads, did a published version
of its package accept or write the old name?

**Run** (from the repository root; downloads every published tarball of six packages once):

```bash
node specs/issues/FIX-2454/poc/retired-census/census.mjs            # PASS
node specs/issues/FIX-2454/poc/retired-census/census.mjs --control  # must FAIL
```

**Result, 2026-11-05, on `origin/main` d6a38c09.** PASS: 29 entries, 10 published and 19 never
(by kind: values 3 published; keys 6 published, 10 never; stored shapes 1 published, 9 never).
Totality: 75 refusal-shaped `src` lines, none unowned. `--control` fails on the planted line and
on the flipped `row-questions` entry, as it must.

**What it changed.** The issue named three never-published task-row shims. The census found six
of the seven, plus core's `waitForUser` resume map and ten refused keys no published version
accepted. The implementer moves its refusal shape and totality scan into the vocabulary sweep
(DECISIONS.md); the 19 become leg b's `shims.unpublished-shapes` scope.

**Amended 2026-11-06.** Under epic D4 (no backward-compat code) nothing moves into the sweep, and
the ten published entries are deleted too, not kept through a helper. The census's verdicts stand;
only the "kept" column's fate changed. The cell is named `shims.never-published` in FIX-2564's grid.

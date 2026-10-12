# Vocabulary sweep (FIX-1876 POC)

**Question:** how big is the rename the epic's D3 asks for, and can a machine tell when it's done?

```bash
node specs/issues/FIX-1876/poc/vocabulary-sweep/sweep.mjs            # report and verdict
node specs/issues/FIX-1876/poc/vocabulary-sweep/sweep.mjs --list     # every open line
node specs/issues/FIX-1876/poc/vocabulary-sweep/sweep.mjs --only ask # one family
node specs/issues/FIX-1876/poc/vocabulary-sweep/sweep.mjs --control  # a planted parkOnAsk must be caught
```

No dependencies; run from the repository root. It reads git-tracked files only.

**Showed (2026-10-12, `main` at `da8f63fd7`):** 3,749 of 4,100 tracked files scanned, 351 excluded
by named rules, none unruled. 2,156 open lines in 289 files: 995 in the wait family, 1,156 in the
dispatch family, 7 stale `post-to-mailbox` mentions. The keep list is seeded, not finished, so
some wait-family lines are questions to a person that will be kept. The control fails as it should.

Throwaway as written. P3 of the plan moves it to `goals/vocabulary/one-word-per-thing/`, where it
becomes the goal check. Not part of any package's tests.

# vocabulary › one word per thing

**Issue:** FIX-1876
**Outcome:** Each word names one mechanism, everywhere a reader meets it: an API name, a stack trace, a test name, a page. *Dispatch* starts work on another worker, *wait* is what a turn does on a task it dispatched, *ask* is only a question to a person, and *hand-off* is only passing work that is already under way. A reader who meets one of these words looks for one mechanism, not two.
**Input:** the repository itself. Every git-tracked file under `packages`, `apps`, `docs/architecture`, `.changeset` and `goals`. Held-out by construction: the next commit is a different input, and a new file that uses a retired word fails it.
**Signal:** `sweep.mjs` scans every tracked file under those roots, or excludes it by a named rule. It fails on any use of a retired name or meaning (`rules.mjs` → `RETIRED`) that the keep list (`KEEP`, each entry with its reason) doesn't classify and that doesn't carry `retired-name-refusal` on its line. It also fails on any file that is neither scanned nor excluded. Passes at OPEN 0 with no unruled file.
**Anti-game:** A sweep that reads nothing passes everything, so `--control` plants `parkOnAsk` in a file the sweep reads, through the same path as a real file, and the goal fails unless the sweep reports it. The keep list is never widened to silence a hit: `KEEP` grows only with a reason a reviewer can check, and `RETIRED` is never narrowed. The totality check stops a new root or file type from slipping past unread.
**Model:** n/a — model-free.
**Run:** `pnpm tsx goals/vocabulary/one-word-per-thing/run.mts` (CI's Process guards run `node goals/vocabulary/one-word-per-thing/sweep.mjs` and the same with `--control`)
**Output:** `run.mts` passes `--list`, so a local FAIL prints every open line; CI's step prints only the per-file summary. Both fail on the same lines.
**Controls:** `--control` on `sweep.mjs`: the planted `parkOnAsk`, and FIX-2070's `messageWorker` and `replyTo` (FIX-2242 D2), must each be reported by its own rule.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | 819d6f2a + FIX-1876 P3 | n/a (model-free) | PASS | 1,026 hits: 28 marked `retired-name-refusal`, 998 kept by reason, OPEN 0; 0 files unruled. The planted `parkOnAsk` was reported. |
| 2026-10-14 | same, with "A worker can hand off work to another worker." added to `task-board.md` | n/a (model-free) | FAIL (expected) | Non-vacuity: the tree leg failed on the planted sentence (`handoff-prose`), so a new retired use on a real page is caught. |

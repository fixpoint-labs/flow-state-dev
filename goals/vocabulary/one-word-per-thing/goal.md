# vocabulary › one word per thing

**Issue:** FIX-1876
**Outcome:** Each word names one mechanism, everywhere a reader meets it: an API name, a stack trace, a test name, a page. *Dispatch* starts work on another worker, *wait* is what a turn does on a task it dispatched, *ask* is only a question to a person, and *hand-off* is only passing work that is already under way. A reader who meets one of these words looks for one mechanism, not two.
**Input:** the repository itself: every git-tracked file. Code and published pages are read for every retirement; the contributor trees (`docs/contributing/`, `.agents/`, the root `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` and `README.md`, pending changesets, and the notes beside a lab or an example) for retired names only (FIX-2354 D1). History and tooling are excluded by name. Held-out by construction: the next commit is a different input, and a new file that uses a retired word fails it.
**Signal:** `sweep.mjs` scans every tracked file, or excludes it by a named rule. It fails on any use of a retired name or meaning (the glossary's retirements, `docs/contributing/glossary.mjs`) that an exemption (each with its reason) doesn't classify and that doesn't carry `retired-name-refusal` on its line. It also fails on any file that is neither scanned nor excluded. Passes at OPEN 0 with no unruled file.
**Anti-game:** A sweep that reads nothing passes everything, so `--control` plants `parkOnAsk` in a file the sweep reads, and `isInProcessDispatcher` in a contributor doc and in a skill, through the same path as a real file, and the goal fails unless the sweep reports it. An exemption is never widened to silence a hit: one is added only with a reason a reviewer can check, and a retirement is never narrowed. The totality check stops a new root or file type from slipping past unread.
**Model:** n/a — model-free.
**Run:** `pnpm tsx goals/vocabulary/one-word-per-thing/run.mts` (CI's Process guards run `node goals/vocabulary/one-word-per-thing/sweep.mjs` and the same with `--control`)
**Output:** `run.mts` passes `--list`, so a local FAIL prints every open line; CI's step prints only the per-file summary. Both fail on the same lines.
**Controls:** `--control` on `sweep.mjs`: the planted `parkOnAsk`, FIX-2070's `messageWorker` and `replyTo` (FIX-2242 D2), and FIX-2354's `isInProcessDispatcher` under `docs/contributing/` and `.agents/skills/`, must each be reported by its own rule. On `main` before FIX-2354 neither contributor-tree plant is read, so that control fails there.

## The words

The words, what each retires, where each reaches and what is exempt are in the glossary, `docs/contributing/glossary.mjs`. Nothing here restates them.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | 819d6f2a + FIX-1876 P3 | n/a (model-free) | PASS | 1,026 hits: 28 marked `retired-name-refusal`, 998 kept by reason, OPEN 0; 0 files unruled. The planted `parkOnAsk` was reported. |
| 2026-10-14 | same, with "A worker can hand off work to another worker." added to `task-board.md` | n/a (model-free) | FAIL (expected) | Non-vacuity: the tree leg failed on the planted sentence (`handoff-prose`), so a new retired use on a real page is caught. |
| 2026-11-07 | 322687264 + FIX-2354 | n/a (model-free) | PASS | Every tracked file (8,580): 5,150 scanned, 3,430 excluded by named rule, 0 unruled. 1,741 hits: 49 marked, 1,692 kept, OPEN 0. `--control` reported both contributor-tree `isInProcessDispatcher` plants, and the guard's `--control` refused its two. Exemptions this change added: 4 in `.agents/` and the contributor docs (AskUserQuestion, openQuestions, the agent-mailbox board, a skill's worked example), 1 in `.changeset/` (the no-compat notes), 2 in `labs/` (a hold's `ask`, `ASK_MARKER_IGNORED`); 2 widened (the English verb *Ask* to labs, examples and `.agents/`; *no exported member*). |
| 2026-11-07 | same, without the two leftover renames | n/a (model-free) | FAIL (expected) | Red first: `--only dispatcher` OPEN 2, exactly `architecture-reference.md:78` (`isInProcessDispatcher`) and `issue-multi-pr.js:16` (`topologicalDispatcher`). On `main` (`322687264`) neither plant path is read: the sweep's roots skip both, and the guard files both under `process` (kept). |

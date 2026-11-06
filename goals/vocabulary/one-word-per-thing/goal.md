# vocabulary › one word per thing

**Issue:** FIX-1876
**Outcome:** Each word names one mechanism, everywhere a reader meets it: an API name, a stack trace, a test name, a page. *Dispatch* starts work on another worker, *wait* is what a turn does on a task it dispatched, *ask* is only a question to a person, and *hand-off* is only passing work that is already under way. A reader who meets one of these words looks for one mechanism, not two.
**Input:** the repository itself. Every git-tracked file under `packages`, `apps`, `docs/architecture`, `.changeset` and `goals`. Held-out by construction: the next commit is a different input, and a new file that uses a retired word fails it.
**Signal:** `sweep.mjs` scans every tracked file under those roots, or excludes it by a named rule. It fails on any use of a retired name or meaning (`rules.mjs` → `RETIRED`) that the keep list (`KEEP`, each entry with its reason) doesn't classify and that doesn't carry `retired-name-refusal` on its line. It also fails on any file that is neither scanned nor excluded. Its retired-tables pass (FIX-2454, `RETIRED_TABLES`) fails on a refusal-shaped line under `packages/<pkg>/src` that no package table owns and that does not go through the helper (`retired-unowned`), on a table entry whose `removeIn` is at or below its package's version (`retired-expired`), and on a `@deprecated` alias whose removal version has arrived (`retired-alias-expired`, the epic's Q1 default, pending its owner). Passes at OPEN 0 with no unruled file.
**Anti-game:** A sweep that reads nothing passes everything, so `--control` plants `parkOnAsk` in a file the sweep reads, through the same path as a real file, and the goal fails unless the sweep reports it. The keep list is never widened to silence a hit: `KEEP` grows only with a reason a reviewer can check, and `RETIRED` is never narrowed. The totality check stops a new root or file type from slipping past unread.
**Model:** n/a — model-free.
**Run:** `pnpm tsx goals/vocabulary/one-word-per-thing/run.mts` (CI's Process guards run `node goals/vocabulary/one-word-per-thing/sweep.mjs` and the same with `--control`)
**Output:** `run.mts` passes `--list`, so a local FAIL prints every open line; CI's step prints only the per-file summary. Both fail on the same lines.
**Controls:** `--control` on `sweep.mjs`: the planted `parkOnAsk`, and FIX-2070's `messageWorker` and `replyTo` (FIX-2242 D2), must each be reported by its own rule; so must FIX-2454's plants, each by path and entry: an unowned refusal, a table entry at its package's version, and an alias whose removal version has arrived.

## Collection item

Stored collection data is an **item**, not a row. In prose, say "collection item". The public client names are the anchor: `CreateCollectionItemOptions`, `CollectionItemHandle` (`rules.mjs` → `COLLECTION_ITEM`).

**Record** stays a verb (`recordHarnessUsage`, a run record). It is not the noun for collection data.

**Entry** is already taken (inbox entries, flow entries, `CollectionSnapshotEntry`). It is not the noun for collection data either.

Core's `OutputItem` and `getItems` are response items: what a run streams back (a message, a tool result, a status). They are not collection items. A collection item is the value a collection stores. The two share the word "item" and nothing else.

**Exempt:** a real UI table row. That is a rendered table, a grid row, a DOM `<tr>`, or a component such as BoardColumns.

**Scope:** new code and new docs only. This sweep does not apply the rule. The existing names stay until someone next edits that file. `scripts/check-retired-terms.mjs` flags a line this change adds. A new `type` or `interface` whose name ends in `Row` counts when the file is a collection module, the line mentions a collection, or the name contains `Collection`. Docs prose counts when it says "collection row", "collection's row", or "the row of the collection". The guard's other areas apply: history, process, goals, and root config stay out.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | 819d6f2a + FIX-1876 P3 | n/a (model-free) | PASS | 1,026 hits: 28 marked `retired-name-refusal`, 998 kept by reason, OPEN 0; 0 files unruled. The planted `parkOnAsk` was reported. |
| 2026-10-14 | same, with "A worker can hand off work to another worker." added to `task-board.md` | n/a (model-free) | FAIL (expected) | Non-vacuity: the tree leg failed on the planted sentence (`handoff-prose`), so a new retired use on a real page is caught. |

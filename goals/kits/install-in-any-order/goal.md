# kits › it installs in any order

**Issue:** FIX-2626
**Outcome:** An app lists several kits in one list, in any order. Each kit gets what the kits that require it put in its slots, a kit's contribution carries what its own dependents gave it, and every file in a kit's folder is used, or the app refuses to start and names it.
**Input:** The fixture kits in `fixture/kits.mts`: `b` declares a keyed slot (`entries`) and a list slot (`order`) and owns the folder `b/`; `c` requires `b`, declares its own list slot (`extras`) and builds its entry in `b` from it; `d` requires `c`, fills `c.extras` and `b`'s slots. The app (`fixture/fsdev.config.mts`) lists `[d, b, c]`. Also valid: a fourth kit with no folder or slots, listed first.
**Signal:** Read through `fsdev run` against the fixture config.
- `a:served`: `b-flow`, `c-flow` and `d-flow` each answer.
- `a:entries`: `b`'s keyed slot holds `c`'s and `d`'s entries. `a:order`: `b`'s list is `[c, d]`.
- `a:chain`: `c`'s entry in `b` is `c carries [from d]`, built from what `d` put in `c`'s slot.
- `a:folder`: `b` reads `b/greeting.txt` beside the config.
- `b:duplicate`, `b:stray`, `b:unrequired`: the app does not start, and stderr names `d` repeating `c`'s key, the stray `notes.txt` in `b`'s folder, and kit `e` filling `b.order` without requiring `b`.
- `c:relative`: a relative `directory` for `b`, run from another directory, reads that directory's folder.
**Anti-game:** Assert on what the running app serves (the `b-flow` answer, read from the capture) and what it refuses (its exit code and stderr), never on what `defineKit` returns. The kits are never listed in requires order: that hides an install in list order. Every graded list is floored with `tell.over`, so an empty answer is CAN'T TELL.
**Model:** n/a (no model is called)
**Run:** `pnpm tsx goals/kits/install-in-any-order/run.mts`
**Controls:** each patches `packages/engine/src/flowstate/kits.ts` as the app loads it (`goals/lib/module-patch`), so nothing is written to the checkout.
- `GOAL_CONTROL=list-order`: installs in the listed order. Must fail `a:entries`, `a:order` and `a:chain` (and `b:duplicate`, since `d`'s repeat never merges).
- `GOAL_CONTROL=requires-first`: contributions run owners first, so `c` contributes before `d` and the app fill its slot. Must fail `a:chain`; it also fails `a:entries` and `a:order` (no leg isolates the chain: the same reordering empties `b`'s slots).
- `GOAL_CONTROL=skip-unknown`: the claim pass reports nothing. Must fail `b:stray` only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | claude/fix-2626-impl (pre-push) | n/a | PASS | entries `{"c":"c carries [from d]","d":"from d"}`, order `["c","d"]`; the three refusals named; relative path read `hello from elsewhere` |
| 2026-11-11 | claude/fix-2626-impl (pre-push) | n/a | FAIL (expected) | `list-order`: a:entries `{"c":"c carries []"}`, a:order `["c"]`, a:chain, b:duplicate started |
| 2026-11-11 | claude/fix-2626-impl (pre-push) | n/a | FAIL (expected) | `requires-first`: a:entries `{}`, a:order `[]`, a:chain undefined, b:duplicate started |
| 2026-11-11 | claude/fix-2626-impl (pre-push) | n/a | FAIL (expected) | `skip-unknown`: b:stray started and answered |

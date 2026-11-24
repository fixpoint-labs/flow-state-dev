# vocabulary › resource names › new code says entry

**Issue:** FIX-2631 (epic FIX-2600). Its spec's goal: `specs/issues/FIX-2631/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a change that names a resource "row" in new code, or uses one of the six phrases anywhere, is stopped before it merges, while store adapters and UI list modules keep their rows. The 2,168 row locals, parameters and properties already in the tree stay until FIX-2632 renames them.

**Input:** the repository's tracked tree at one commit, copied into a fresh repository whose `main` is that commit, with the rule as built laid over it. One commit on a topic branch adds names generated at run time, so no list knows them: a row local in a package picked at random from those outside the kept paths, a `T…Row` type parameter in another, a phrase (`each task's rows`) in a third package's test name. The same commit adds a `row` local in `packages/store-sqlite` and in `packages/react/src/components/`, and edits a line that already declares `row`.

**Signal:** each failure is tagged `<leg>:`.

- `open`: the guard's whole-tree run reports 0 under the resource entry, over every tracked file.
- `adds`: each committed name is reported both ways, and each way exits 1. The hook way runs the guard lines of the tree's own `.husky/pre-push` as written, the loop fed a pushed ref and a deletion on stdin, its base `merge-base origin/main <sha>`. The CI way runs the tree's own `ci.yml` run lines for the guard, `--control` left out, base `HEAD^1`.
- `keeps`: neither way reports the store-adapter `row`, the `components/` `row`, or the edited line.

**Anti-game:** nothing asserts on the in-memory plants or a mocked diff; both pass while the git path reads nothing. The hook's loop and CI's base come from the tree under test, so a step missing there is missing here. `adds` floors on the number of names committed (3), `open` on the tracked-file count. The kept paths are checked against what a store adapter and a UI list module are, from the spec, not from the glossary.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/vocabulary/resource-names/new-code-says-entry/run.mts` (reads `HEAD`; `--at <ref>` reads another commit's tree with this checkout's rule laid over it).

**Controls:**

- `GOAL_CONTROL=no-base`: the copy has no `origin/main`, so the hook's loop skips, and CI's run lines lose `--added-since`. Must FAIL on `adds` (the local).
- `--at <origin/main before FIX-2631>`: that tree's hook and CI have no added reach, and its lines carry the phrases. Must FAIL on `open` and on `adds`.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-09 | 60661ab7f | n/a (model-free) | PASS | open: OPEN 0 over 8664 tracked files. adds: a local in `core`, a type parameter in `thought-fabric-core`, a phrase in `mcp`'s test, each reported by the hook (merge base) and CI (`HEAD^1`). keeps: store-sqlite and react/components locals and an edit to `packages/claude-code/src/sdk/model-list.ts:85`, reported by neither. |
| 2026-11-09 | 60661ab7f + `GOAL_CONTROL=no-base` | n/a (model-free) | FAIL (expected) | adds: neither way reported the local; the type parameter and the phrase still were, by the whole-tree run. |
| 2026-11-09 | cadc16809 (origin/main, control) | n/a (model-free) | FAIL (expected) | open: OPEN 234 (232 phrase lines, `PROJECT_ROW_RESOURCES`, the `rows` test helper). adds: neither way reported the local; that tree has no added reach. |

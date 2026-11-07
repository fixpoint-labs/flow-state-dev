# core › it root-is-for-app-authors

**Issue:** FIX-2448
**Outcome:** Someone who autocompletes `@flow-state-dev/core` to write a flow sees the names an app author uses or the docs teach: no coding-harness or pull-request vocabulary, no runtime seam. The harness contract is on `core/harness`, the seams our own packages share are on `core/internal`, and no app, example or lab imports any package's `/internal` path.
**Input:** the repository tree: every published root's names, read from source, and every import in `apps/`, `examples/` and `labs/`, through the export check's one import census. Held-out: the check reads who imports each name, never a list the change writes; a new root name one Kitchen Sink file imports passes, the same name imported only by engine fails. The moved list is the spec's frozen `specs/issues/FIX-2448/poc/export-census/moved.tsv`; a row a later change renamed is read under its new name (`MOVED_RENAMES` in `scripts/packed-install/goal.mjs`, with its reason).
**Signal:** `check.mjs --after` exits 0 when all three hold:
- **core-root:** core's root fails the export check on no name but moved.tsv's `benchmark` rows, which another issue moves.
- **moved-gone:** no `harness`, `internal` or `unexport` row is on the root or `core/types`; each `harness` row is on `core/harness`, each `internal` row on `core/internal`, each `unexport` row on no public entry.
- **no-internal:** no adopter file imports any `@flow-state-dev/*/internal` path, by `import`, `import type`, `import()` or `require`.
It also lists each core root name a README or changeset line is the only thing clearing, where the spec's census commit (d6a38c09) did not clear it that way, for the PR's reviewer. The installed half (moved names read from the packed core's `.d.ts`, `BlockContext`'s members, no compiled test file in the tarball) is the packed-install leg `surface.core-installed-dts`, not a second pack here.
**Anti-game:** the allow-list is adopter code, the package README (or a pending changeset whose `Docs:` line names it) and the docs site; a goal's or a sibling package's import counts for nothing, and a README word in prose counts for nothing, only a code-form mention. The base is read through `gitReader`, so there is no baseline file to edit. A README line added only to clear a name is the hollow pass: the reviewer list prints each one. Each assertion floors what it read (`core root names`, `moved rows`), so an empty read is CAN'T TELL.
**Model:** n/a. No generator; the path under test is the published surface.
**Run:** `node goals/core/root-is-for-app-authors/check.mjs --after [ref]` (a git ref reads that commit's tree).
**Controls:** `node goals/core/root-is-for-app-authors/check.mjs --control` plants, over the real tree, a consumer-less core root name, a sibling-only engine root name, a goal-only core root name, an app `import type` of `core/internal`, a lab `import()` of `engine/internal`, a README line listing bare names, and a moved name (`recordPullRequests`) re-added to the root, and requires each to be named. `--after origin/main` before the change must FAIL **core-root**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-07 | 181ef2ad6 | n/a | FAIL (expected) | The tree before the rulings: `--after 181ef2ad6` red on **core-root**, 110 names (moved-gone 0, no-internal 0; 456 core root names, 111 moved rows read). |
| 2026-11-07 | d6a38c09 | n/a | FAIL (expected) | The spec's census commit: core-root 137, moved-gone 284, no-internal 2. |
| 2026-11-07 | 5836f1595 | n/a | PASS | core-root: only the 4 failing benchmark rows remain; 111 moved rows each in their one home (`SessionView` read as `PeerSessionView`); no adopter `/internal` import. Reviewer list: `DispatchWaitResult`, `SequencerOutputSchemaError`, `SequencerSchemaMismatchError`, `RecordedValueOmittedError`, `RECORDED_VALUE_OMITTED`, `isAbortLike`, each cleared by this PR's changeset. `--control`: all 7 plants named. |

# workforce-mailboxes › a pre-rename Lab is refused by name

**Issue:** FIX-1748 (the boot leg of the spec's goal check; the guard leg is `scripts/check-mailbox-rename.mjs`)

**Outcome:** Mailboxes used to be called channels, and nothing reads the old names any more. A Lab whose tree or store was written before the rename stops at boot and says so: which file or mailbox, that it predates the rename, and what to do (move the file, or start from an empty store). It never opens with mailboxes missing their history and nothing said. The same tree on an empty store opens, a custom-kind mailbox included.

**Input:** `fixtures/old-tree/`: one team with one record left under its old folder and file name. `fixtures/tree/`: the same desk renamed, with a mailbox on the built-in kind (`front`) and one on `digest`, a kind of the app's own (the one the mailbox-boards goal's tree ships). `host.mts` is the Lab's boot from the published packages: read the tree and refuse it if it did not load, refuse a store from before the rename, open the mailboxes. Each leg gets its own filesystem store, seeded out of band with the old names `@flow-state-dev/workforce` exports for exactly this.

**Signal:** the message a person reads when the boot stops, and the store afterwards.

- **tree**: over the old tree, the boot stops naming the old file and `teams/desk/mailboxes/front/MAILBOX.md`, and says the name predates the rename.
- **store**: a session on the old built-in kind at `desk.front`. The boot stops naming `desk.front`, the rename and the reset, and the old session is still there afterwards.
- **custom**: `desk.notices` on `digest`, whose kind never changed, with a transcript line under the old item name. The boot stops naming `desk.notices` and the rename.
- **fresh**: the renamed tree on an empty store opens both mailboxes, `desk.front` on `mailbox` and `desk.notices` on `digest`.

**Anti-game:** every leg asserts on the words a person reads, never only that something threw: an old store already failed before this issue, telling the person to rename their mailbox. Nothing is graded on a unit seam.

**Model:** n/a. No generator runs.

**Run:** `pnpm --dir goals exec tsx workforce-mailboxes/a-pre-rename-lab-is-refused-by-name/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-detector`: the Lab boots without its store check. A custom kind's session then looks open to the binder. Must FAIL at **custom**, and at nothing else.

The detectors inside the package have no switch, by design. With the loader's and the binder's checks commented out as well, **tree**, **store** and **custom** FAIL and **fresh** stays green; logged below and restored.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-04 | FIX-1748 P1 branch, uncommitted | n/a | FAIL (control) | **`GOAL_CONTROL=no-detector`, taken first.** Failed at **custom** only: `want desk.notices named, got "it opened"`. |
| 2026-10-04 | FIX-1748 P1 branch, uncommitted | n/a | FAIL (by hand) | `no-detector` plus the loader's and the binder's checks commented out: **tree** (`it opened`), **store** (the binder's collision message, `rename the mailbox rather than have its binder delete that session`) and **custom** FAIL; **fresh** green. Restored. |
| 2026-10-04 | FIX-1748 P1 branch, uncommitted | n/a | **PASS** | **tree** names the old file and `teams/desk/mailboxes/front/MAILBOX.md`; **store** and **custom** stop with `this store was written before channels were renamed to mailboxes … Start from an empty store`, naming `desk.front` (old kind) and `desk.notices` (old item name); **fresh** opens `desk.front` on `mailbox` and `desk.notices` on `digest`. |

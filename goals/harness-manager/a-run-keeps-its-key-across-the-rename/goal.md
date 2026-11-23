# harness-manager › it keeps a run's key across the rename

**Issue:** FIX-2877 (epic FIX-2876), leg c of its goal check. Its spec's goal: `specs/issues/FIX-2877/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a coding run that was in flight when the harness kit's mode took its name keeps working. The kit's runs were keyed `<epic>/<issue>/code`; they are now keyed `<epic>/<issue>/default`. A run stored under the old key and resumed after the change is found there and finishes there: the same branch, the same checkout and the same coding session, and nothing is written under the new key. A run that starts after the change is keyed by the new name.

**Input:** harness-manager on a real engine, a real claim gate, real fenced settlement and a real git checkout cut from a scratch repository (the package's claim host, `packages/harness-manager/test/claim-host.ts`). The "before" manager keys its runs by the fixture's former segment; the "after" manager is a new engine over the same stores and checkouts, on the kit's real mode names (`codingMode({})`). Only the harness is a stub. `fixtures/input.json`, held out: the former segment, the conversation the task is filed in, and the task's goal. Any partition and goal pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`. The run record is read from the store; what the run was handed (its session and folder) from the stub harness's own record of the call.

- `resume:session` the resumed run is handed the stored session; `resume:checkout` it works in the stored checkout; `resume:finished-there` the old key's record is attempt 2, succeeded; `resume:branch` its branch is the stored one; `resume:nothing-new` nothing is written under the new key.
- `new:keyed-by-name` a run that starts after the change finishes under the new key; `new:not-former` and writes nothing under the old one.
- `mode:renamed` the kit's mode no longer carries the former name.
- `fixed:resume` on a fixed board, a row filed before the change names its segment in its payload (`{ issue, phase: "code" }`): it runs on the renamed mode and resumes its stored session; `fixed:finished-there` it finishes under the old key; `fixed:nothing-new` it writes nothing under the new one. This leg was added after review. The first legs file a task with no payload, so they never reach the manager's row identity check.

**Anti-game:** the "after" manager reads the kit's mode names from the kit, so a kit that drops `formerName` fails `resume:session`. The record is read from the store, never from the manager's output. The session and folder are what the harness was handed, not what the record says.

**Model:** n/a (model-free: a stub harness).

**Run:** `pnpm tsx goals/harness-manager/a-run-keeps-its-key-across-the-rename/run.mts`.

**Controls:** a scratch patch applied as the code loads, printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=no-legacy-key`: `readModeRunRecord` never reads the former key (`packages/harness-manager/src/run-record.ts`). Must fail **`resume:session`**: the resumed task starts a fresh run on a new branch.
- `GOAL_CONTROL=former-name-refused`: the manager's row identity check takes only the mode's name, not its former name (`packages/harness-manager/src/manager.ts`). Must fail **`fixed:resume`**: the row filed as `code` is refused and never runs.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-23 | fix/fix-2877-p1 (working tree) | n/a | PASS | A run stored under `…/t1/code` resumed on session `sess_1`, its branch and checkout, and finished there; nothing under `…/t1/default`. A new run was keyed `…/t2/default` |
| 2026-11-23 | fix/fix-2877-p1 (working tree) | n/a | FAIL (control, as required) | `no-legacy-key`: `resume:session` (handed no session), `resume:checkout` (a new `t1-default-…` checkout), `resume:finished-there`, `resume:nothing-new` |
| 2026-11-23 | fix/fix-2877-p1 (working tree, after review) | n/a | PASS | All legs, the new `fixed` leg too: a fixed-board row filed as `code` resumed on its session and finished under `feature-board/FIX-1/code` |
| 2026-11-23 | fix/fix-2877-p1 (working tree, after review) | n/a | FAIL (each control, as required) | `no-legacy-key`: `resume:session`. `former-name-refused`: `fixed:resume` (no run, the row pending), `fixed:finished-there` |

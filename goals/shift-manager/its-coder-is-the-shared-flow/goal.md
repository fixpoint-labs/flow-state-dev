# shift-manager › its coder is the shared flow

**Issue:** FIX-2877 (epic FIX-2876), leg b of its goal check. Its spec's goal: `specs/issues/FIX-2877/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** Shift Manager picks its coder through one coding flow and one default. Its coder is the harness kit's `coder` flow, so changing the Lab's `defaultHarness` changes the coder that runs, with nothing else edited. The readiness view and the coder accept the same harness ids.

**Input:** the DevTeam Lab (`openLab`) on a projects workspace with one project (a scratch bare repository), filled with two scripted harness values under the held-out ids in `fixtures/input.json`. The Lab is opened once with each id as `defaultHarness`. The coordinator's judgment is scripted: the held-out message is filed once, as `createTask` for `eng.coder`, whose `WORKER.md` names no harness. Any two distinct ids pass the same way.

**Signal:** each failure is tagged `b:<assertion>`. What ran is read from each scripted agent's own run log, the stored task (found by its filer session) and the run's own session. Nothing is read from a reply.

- `b:ran-on-default`: for each id as the default, the task completes with that agent's answer, and only that agent ran.
- `b:coder-flow-run`: the run's session belongs to the kit's `coder` flow, and the kit's `harness` read in that session answers the same id.
- `b:readiness-equals-coder`: the readiness view lists exactly the ids the coder runs, in order.
- `b:hire-refused`: a hire of a `coder` worker naming an id outside them is refused, and the refusal names exactly the readiness ids.

The spec's signal reads "the run record names that harness". A run record names its harness only by the vendor `source` its handle reports, and both scripted values report the same one (`harness-manager/stub`). So this goal reads the harness from the agent that ran and from the coder session's own `harness` read instead.

**Anti-game:** no worker file and no prompt names a harness. The default reaches the coder only through `openLab({ defaultHarness })`, which is the kit's `defaultHarness`. Each scripted agent answers with its own id, so a run on the wrong one can't pass `b:ran-on-default`.

**Model:** n/a (model-free: scripted judgment, scripted harnesses).

**Run:** `pnpm tsx goals/shift-manager/its-coder-is-the-shared-flow/run.mts`.

**Controls:** a scratch patch applied as the code loads, printed by the run, and refused when it never reached the code.

- `GOAL_CONTROL=default-ignored`: the kit runs a worker naming no harness on the first harness filled, whatever `defaultHarness` says (`packages/harness-manager/src/kit/coder-flow.ts`). Must fail **`b:ran-on-default`**.
- Today's `main` (Shift Manager's own coding flow) can't be opened in this goal's shape, because its `openLab` takes a slot, not harness values. Its counterpart is `packages/shift-manager/test/devteam-coder-is-the-kit.test.ts` built in main's shape. Run on main's fork, it failed the kit read: `Flow "coder" does not define action "harness"`, the `b:coder-flow-run` signal. Main's readiness view also listed only the harnesses passed as `harnessValues`, separate from the coder's.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-24 | fix/fix-2877-p4 (working tree on 1d3f0b94f) | n/a | PASS | With `defaultHarness` `alder`, then `birch`, eng.coder (no harness line) ran its task on that id only, in a `coder` session reporting it. Readiness listed [alder, birch], and a hire on `windsurf` was refused naming exactly those |
| 2026-11-24 | fix/fix-2877-p4 (working tree on 1d3f0b94f) | n/a | FAIL (control, as required) | `default-ignored`: `b:ran-on-default` (with `birch` as the default the task ran on `alder`) and `b:coder-flow-run` |

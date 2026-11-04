# harness-manager › where the work went

**Issue:** FIX-2386 (epic FIX-2369). Its spec's goal: `specs/issues/FIX-2386/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** wherever a coding run worked, in a harness session or as a board task, a person can see its branch and how many commits it made, and the commands they copy from it reach the work: `cd` lands on the run's branch, and `git log <baseCommit>..<branch>` lists exactly the run's commits.

**Input:** two scratch repositories, each under a path with a space in it. Leg a: a `harnessSessionFlow` served by `createFlowState` and called through the API client over the engine's routes, its workspace the workspace package's local host writing the user's worktree rows (FIX-2439), its harness a script that commits one file per turn; then a second session attached to the first one's worktree. Leg b: the harness-manager goal host (`../host.mts`) with `harnessStub` in the slot, committing once, no review. `fixtures/input.json`, held out: the commit subjects, the issue and the phase. Any others pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a`: after each of two turns, `a:recorded` the session's state, read through the client (`sessions.state`), points at a worktree row, read through the client's resource route, that names the session's branch, an existing path, and the base the workspace host cut it at; `a:count` the row's count is 1, then 2. `workPlace` of that row gives commands that, run in `bash`: `a:cd` land on the branch; `a:log` list exactly the two subjects. `a:attached` the owner's own view names no owner; the attached session points at the same row, and its view says whose worktree it is, with the same count.
- `b`: `b:completed` the task completes; `b:output` its output, read through the host's `status`, reads through `workPlace` as one commit with a path; `b:log` it names a base, and the copied `git log` lists exactly the subject; `b:cd` the copied `cd` lands on the branch.

**Anti-game:** the counts are git's, read by the code under test; the grade runs the commands `workPlace` built in a real shell rather than comparing strings. Leg a reads the session and the row through the client's routes, so a field the flow doesn't expose reads as missing. The base is compared with the scratch repository's `HEAD`, read independently.

**Model:** n/a (model-free).

**Run:** `pnpm tsx goals/harness-manager/where-the-work-went/run.mts`. `GOAL_LEGS=a,b` runs some legs.

**Controls:** scratch patches to the code under test, applied as it loads, printed by the run, and refused when they never reached the code.

- `GOAL_CONTROL=no-record`: the session flow stores `null` where it points at the row (`session-flow.ts`). Runs leg a. Must fail **`a:recorded`**.
- `GOAL_CONTROL=no-viewer`: `workPlace` ignores who is looking (`work-place.ts`). Runs leg a. Must fail **`a:attached`**.
- `GOAL_CONTROL=no-base`: the manager's output names no `baseCommit` (`manager.ts`). Runs leg b. Must fail **`b:log`**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | claude/project-thread-0v1h4j (working tree) | n/a | PASS | a: 2 commits on `where/<session>`, the copied `git log` listed both subjects; b: 1 commit on the run's branch, the copied `git log` listed the subject |
| 2026-10-31 | claude/project-thread-0v1h4j (working tree) | n/a | FAIL (each control, as required) | `no-record`: `a:recorded` (no workspace after turn 1). `no-base`: `b:log` (output `base: null`) |
| 2026-10-31 | claude/project-thread-0v1h4j (spec round-1 fold: `baseCommit`, `commitsVerified`, turn-end branch) | n/a | PASS green; FAIL each control, as required | green: a 2 commits, b 1 commit, copied `git log` lists the subjects. `no-record`: `a:recorded`. `no-base`: `b:log` (`baseCommit: null`) |
| 2026-11-01 | claude/project-thread-0v1h4j on FIX-2439's branch (session points at the worktree row) | n/a | PASS green; FAIL each control, as required | green: a 2 commits on the row's branch, attached session reads the same row; b 1 commit. `no-record`: `a:recorded`. `no-base`: `b:log`. `no-viewer`: `a:attached` |

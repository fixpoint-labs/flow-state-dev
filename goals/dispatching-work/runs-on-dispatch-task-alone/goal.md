# dispatching-work › it runs on dispatchTask alone

**Issue:** FIX-1887, the closure of epic FIX-1870. Its spec's goal: `specs/issues/FIX-1887/SPEC.md` → "The goal, and how we'll know it's met"; its plan: `specs/issues/FIX-1887/PLAN.md`; the epic's: `specs/epics/FIX-1870/SPEC.md`.

**Outcome:** on one `main` commit, with every other child of FIX-1870 merged, the hand-off checks pass as they did before with workers that can use only `dispatchTask`, their diff since the epic began is names only, and the retired tools and the delivery ledger are gone from the public surface.

**Input:** one clean checkout. The runner composes checks it does not own, each run unchanged as its own process, plus two scripts of its own:

- **P1.m** `rename-map.mjs`: the diff to the six checks (the three regression checks, `goals/hand-offs/ask-survives-a-restart/`, `goals/coordinators/task-session-stays-open/`, `goals/hand-offs/survives-a-restart-and-runs-once/`; the three coordinator checks, `goals/coordinators/hands-each-post-to-its-delegates/`, `goals/coordinators/files-tasks-down-the-owners-chain/`, `goals/workforce-mailboxes/a-routed-post-gets-one-answer/`) from `f1ae352` (the epic spec's merge), and FIX-1872 V9's reruns from the control commit. The map is read off FIX-1875's and FIX-1876's pinned tables; `fence-lines.json` lists each admitted fence line with its path, the removed and added text, and why.
- **P1.s** `surface-sweep.mjs`: seven rules over package source, package READMEs, published pages, team worker files and the reference app, read through `git grep` at one commit.
- **P1.r** FIX-1820's closure runner (`goals/hand-offs/survives-a-restart-and-runs-once/run.mts`), whole. **P1.k** FIX-1610's check and its controls. **P1.c** the controls of FIX-1791's and FIX-1794's checks that P1.r runs plain.
- **P3.a** FIX-1875's check (`goals/dispatching-work/a-recorded-task-waits-for-dispatch/`) and leg e of `goals/workers/files-and-splits-down-the-chain/`. **P3.b** FIX-1872's check (`goals/coordinators/one-fence-answers-each-post-once/`), the two project goals, the pentest lab's two checks and kitchen-sink's `no-landing` control (`goals/kitchen-sink-talk/a-person-talks-to-a-seat-a-mailbox-and-back/`). **P3.c** FIX-1876's sweep (`goals/vocabulary/one-word-per-thing/`) and its leg 2 scenario (`packages/integration-tests/src/scenarios/wait-parked-before-the-rename.test.ts`).

Held out: each composed check picks its own words at run time; the scripts read whatever commit is checked out.

**Signal:** one verdict line per check, each with the commit's SHA. `map:` `rename-map.mjs --rerun-base <control commit>` exits 0, every hunk explained, each fence line printed; `--sources` exits 0 and `--control` exits 2. `sweep:` `surface-sweep.mjs --assert` exits 0 at `HEAD` (0 live lines), exits 1 at the control commit, and `--control` exits 2. Each composed check plain PASS; each control red at exactly its documented tags plus its documented co-failures (CR-7).

**The control commit** is the first parent of the merge of FIX-1875's first PR (#3168), found from `git log --first-parent --merges` and printed by the run.

**Anti-game:** the runner refuses a dirty tree and re-checks `HEAD` before every check. It edits no composed check, writes no row and touches no store. No grade reads a child's unit tests. The map is read off the children's pinned tables (`--sources` fails when they disagree), never edited to fit a diff. A fence line is admitted only in a coordinator check or a V9 rerun, only when listed with its path and reason, and alone: the rest of its hunk is still judged. The sweep refuses a scope that reads no file, and its control commit must FAIL.

**Model:** real for the composed checks that are model-backed: `openai/gpt-5.4-mini` through the AI Gateway (`AI_GATEWAY_API_KEY`), and each check's own `model:` where its `goal.md` names another. The two scripts need none. Blocked, not failed, without a key.

**Run:** `pnpm tsx goals/dispatching-work/runs-on-dispatch-task-alone/run.mts` on a clean checkout. `GOAL_PARTS=P1.m,P1.s` runs some parts (the two scripts alone need no model and run in seconds). On demand only, never a CI gate. The scripts alone:

```
node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs --sources
node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs --control
node goals/dispatching-work/runs-on-dispatch-task-alone/rename-map.mjs --rerun-base <control commit>
node goals/dispatching-work/runs-on-dispatch-task-alone/surface-sweep.mjs --assert [--at <commit>]
node goals/dispatching-work/runs-on-dispatch-task-alone/surface-sweep.mjs --control
```

**Controls:** the runner runs each composed check's controls with its own `GOAL_CONTROL`, graded on the exact red set (must fail, plus the co-failures its check documents). Its own two:

| Control | Must fail |
|---|---|
| `rename-map.mjs --control` | exit 2: a loosened timeout, a dropped leg, an assertion widened to the old name, a shape entry in a regression check, a fence line beside a loosened timeout, in another path or in a regression check, each caught; a pure and a re-wrapped rename explained |
| `surface-sweep.mjs --assert --at <control commit>` | exit 1: the retired surface is live before FIX-1875's first PR |
| `surface-sweep.mjs --control` | exit 2: every rule catches its planted line, and the marker clears it |

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | 37f8058ac (`main` 26121fd3 + this goal) | openai/gpt-5.4-mini (vercel gateway); P1.r's P1.c and P1.d, and leg e, on their own models | FAIL (findings) | Control commit 9e0cabee9. **P1.m** `--sources` 0, `--control` 2, the diff **1**: 58 hunks explained, 94 not (regression checks changed by FIX-1933, FIX-1979 and FIX-1981 since `f1ae352`; comment, import and control rewrites in FIX-1875 P2 and FIX-1872 P2; `{ ask?: }` → `{ wait?: }` in FIX-1876 P1). **P1.s** `--assert` **1** at HEAD (11 live lines, each a migration note or legacy reader without the marker), 1 at the control commit (165), `--control` 2. **P1.r** PASS, every control exact. **P1.k** PASS, five controls exact. **P1.c** `no-roster-check`, `no-round-limit`, `no-delegate-read`, `no-floor`, `no-follow-up` exact; `no-self-choice` and `turn-after-route` red at their verdict logs' documented co-failures, which this runner had not listed (fixed after the run); **`unpartitioned` keeps `c:lists-its-own` green** (no task runs, the reach answers `task_not_found`), twice. **P3.a** PASS, `add-starts` exact, leg e PASS. **P3.b** fence check PASS, `no-ending-dedupe` exact; the project goal FAIL `c:delivers-once` then PASS on rerun (model sent `goal` and `title` with `post: true`); privacy FAIL m3 (empty reply) then PASS on rerun; pentest both PASS; kitchen-sink PASS keyless, `no-landing` at `a:line`, `b:line`. **P3.c** PASS, `--control` caught, leg 2 PASS |

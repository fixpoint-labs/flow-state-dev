# coordinators › every coordinator is a worker file

**Issue:** FIX-1792 (epic FIX-1786). The spec's goal: `specs/issues/FIX-1792/SPEC.md` → "The goal, and how we'll know it's met"; PLAN.md → "Goals" and "Checks" (VG).

**Outcome:** a coordinator is a `WORKER.md` on the `coordinator` flow and nothing else. A desk declared that way answers a person the way its mailbox did: one post, one answer from each delegate. And nothing of the mailbox is left in the repo: no `MAILBOX.md`, no removed export, no `mailboxes` discovery domain, every goal that ran on a mailbox passes again on the converted files, and the three whose feature went are retired with a line naming what proves the rest.

**Input:**

- Leg a: a goal-local tree, `fixtures/workforce/`: one team, `desk`, with a coordinator `WORKER.md` (`flow: coordinator`, `routing: everyone`, `delegates:` naming two workers) and two agent workers (no `flow:` line). `host.mts` is the app: the tree, the published packages, the built-in `agent` flow and Workforce's `coordinator` flow, on SQLite (`@flow-state-dev/store-sqlite`, a fresh file per run), with a scripted model. Held-out: the team, the coordinator and its delegates are read off the tree at run time, never hardcoded, so another team, coordinator name or delegate list passes too; each run's post carries a fresh token.
- Leg b: the repo as it stands. `specs/issues/FIX-1792/poc/inventory/check.mjs` (its `--after` mode and its `GOALS` table, parsed from the file since it is not exported) and `goals/README.md`.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **a** (the converted desk): the person opens a conversation with the coordinator the way a page does (a session on `coordinator` naming it) and posts once through its public `run` action. Read back through the host's own router, as a page reads it:
  - `a:no-mailbox-file`: the tree under test holds no `MAILBOX.md` anywhere. The claim is about a converted desk.
  - `a:loads`: the tree loads without errors, and the coordinator names two or more delegates, each an agent worker in the tree.
  - `a:answers`: the person's conversation shows the post once, and after it exactly one answer line per delegate, under that delegate's name, and none by anyone else.
- **b** (nothing of the mailbox is left):
  - `b:after`: `node specs/issues/FIX-1792/poc/inventory/check.mjs --after`, run from the repo root, exits 0.
  - `b:verdicts`: every unit the checker's `GOALS` table marks CONVERT or REWRITE has a `goal.md` whose verdict log holds a row with PASS (and no FAIL) in its Verdict cell and the tag (`GOAL_VERDICT_TAG`, default `FIX-1792 P4`) in its Commit cell. A unit with no `goal.md` (a shared lab, a scenario file, a goal since retired) is listed as missing.
  - `b:retired`: `goals/README.md` names `workforce-conventions/a-mailbox-holds-the-work-a-seat-drains`, `kitchen-sink-talk/lists-a-filed-case-without-a-reload` and `workforce-mailboxes/a-pre-rename-lab-is-refused-by-name` under its "Retired by FIX-1792" line, and none of those folders exists.

**Anti-game:** leg a never passes on a tree that merely loads, or on a dispatch handle, a routing record or the coordinator's ledger. It grades the lines the person's conversation holds after this run's post, by author. The wait before grading polls until no request runs and then gives a wrongly woken worker 1.5 s to answer; none of it is graded. Leg b reads verdict lines, not exit codes of a subset of goals, and runs the checker as its own process on the tree as it is, so a check that only looked at this goal's fixture could not pass it.

**Model:** n/a. Leg a's agent workers answer from a scripted model (`@flow-state-dev/testing`), keyless; the claim is who answered, not what they said. Leg b calls no model.

**Run:** `pnpm --dir goals exec tsx coordinators/every-coordinator-is-a-worker-file/run.mts`. `GOAL_LEGS=a` or `GOAL_LEGS=b` runs one leg.

**Controls:** on the same command.

- `GOAL_CONTROL=mailbox-left`: before the legs run, the check writes the desk's old file back into the tree under test (`fixtures/workforce/teams/<team>/mailboxes/<coordinator>/MAILBOX.md`, with `members:` the delegates and the coordinator's body) and one source file, `packages/workforce/src/__mailbox_left_control__.ts`, re-exporting a removed name from the removed module. Both are removed afterwards, on a crash and on SIGINT/SIGTERM too. Must FAIL at **a:no-mailbox-file** and **b:after**, and at nothing else; `b:after` must name both plants among its problems.

Leg a's `a:answers` has no named control; the by-hand run below routes the desk `round-robin` instead.

**Known property:** this goal's own folder says "mailbox", so the checker's census counts it as a goal unit. Until its `GOALS` table lists it, `check.mjs --after` reports `unclassified goal: goals/coordinators/every-coordinator-is-a-worker-file`, and `b:after` cannot pass.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-11 | FIX-1792 P4 branch, uncommitted (on `5613e854`) | scripted | FAIL (expected) | `GOAL_LEGS=a GOAL_CONTROL=mailbox-left`: **a:no-mailbox-file** only (`the tree holds teams/desk/mailboxes/front/MAILBOX.md`). Plants gone afterwards; also gone after a SIGINT mid-run (exit 130). |
| 2026-10-11 | FIX-1792 P4 branch, uncommitted (on `5613e854`) | scripted | **PASS** | `GOAL_LEGS=a`. `desk.front` (team `desk`) on SQLite; one post got one answer line each from `desk.amy` and `desk.oz` and none from anyone else; the tree holds no `MAILBOX.md`. |
| 2026-10-11 | FIX-1792 P4 branch, uncommitted (on `5613e854`) | scripted | FAIL (by hand) | `routing: everyone` changed to `routing: round-robin` in the fixture: **a:answers** only (`holds 0 answer line(s) by desk.oz to the post (want 1)`). Reverted. |
| 2026-10-11 | FIX-1792 P4 branch, uncommitted (on `5613e854`) | n/a | FAIL | `GOAL_LEGS=b`, with P4 still in progress. **b:after**: `check.mjs --after` reports files naming removed exports (docs, shift-manager, workforce tests and READMEs) and this goal as an unclassified goal unit. **b:verdicts**: 36 of 41 CONVERT/REWRITE goals have no PASS line on `FIX-1792 P4`, and 5 units hold no `goal.md` (`manager-queue-lab/lab`, `multi-seat-collab/run-scenario.mts`, `pentest-lab/lab`; `mailbox-boards/it-hands-a-task-to-a-fresh-hire` and `org-seats/cos-changes-the-roster`, retired by FIX-1788). **b:retired** green. |
| 2026-10-11 | FIX-1792 P4 branch, uncommitted (on `5613e854`) | n/a | FAIL (expected) | `GOAL_LEGS=b GOAL_CONTROL=mailbox-left`: **b:after** names both plants (`still a MAILBOX.md: …/teams/desk/mailboxes/front/MAILBOX.md`, `names a removed export: packages/workforce/src/__mailbox_left_control__.ts`). **b:verdicts** red as in the row above, so the control also reports it; that clears once the verdict lines exist. |
| 2026-10-11 | FIX-1792 P4 on `3f71fdc11` + the it-ships verdict-table fix | scripted | FAIL (expected) | `GOAL_CONTROL=mailbox-left`, both legs: **a:no-mailbox-file** (`the tree holds teams/desk/mailboxes/front/MAILBOX.md`) and **b:after** (`check.mjs --after` exits 1 on the plants). Both plants removed afterwards; the tree is clean. |
| 2026-10-11 | FIX-1792 P4 on `3f71fdc11` + the it-ships verdict-table fix | scripted | **PASS** | Both legs. a: no MAILBOX.md; `desk.front` on SQLite, one post got one answer line each from `desk.amy` and `desk.oz` and none from anyone else. b: `check.mjs --after` PASS; all 41 CONVERT/REWRITE goals have a PASS line on "FIX-1792 P4"; 5 units without a goal.md (2 retired, 3 support code); 3 retired goals named and gone. |
| 2026-10-12 | f1ae3521 + uncommitted (FIX-1892) | n/a | FAIL (before the fix) | `check.mjs --after` on main alone: **b:after** `FAIL unclassified: scripts/check-retired-terms.mjs`. FIX-1796's retired-terms guard names the retired words on purpose, and the checker had no line for it. |
| 2026-10-12 | f1ae3521 + uncommitted (FIX-1892) | scripted | **PASS** | The checker classifies `scripts/check-retired-terms.mjs` as U (unrelated). Both legs. a: no MAILBOX.md; `desk.front` on SQLite, one post got one answer line each from `desk.amy` and `desk.oz` and none from anyone else. b: `check.mjs --after` PASS; all 41 CONVERT/REWRITE goals have a PASS line on "FIX-1792 P4"; 3 retired goals named and gone. |
| 2026-10-12 | f1ae3521 + uncommitted (FIX-1892) | scripted | FAIL (expected) | `GOAL_CONTROL=mailbox-left`, both legs: **a:no-mailbox-file** and **b:after** only; b:after names both plants (the MAILBOX.md and `__mailbox_left_control__.ts`). |

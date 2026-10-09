# devforce-lab › it waits for a person before it files

**Issue:** FIX-1666

**Outcome:** When a host opens the DevForce goal lab with the ask turned on, the EM seat's session
holds one pending approval, raised the same way every run with no model. Approving it through the
session's own resume files the feature and starts the coder seat on it. Denying it files nothing,
and the EM says so.

Before this, nothing in the lab's tree asked a person anything, so an Inbox pointed at it had
nothing to show and "Approve & run" had nothing to run.

**Input:** `fixtures/input.json`: the feature's issue slug and one-line goal, plus the seat ids.
It is **held-out**: leg 0 asserts that neither string appears in any of the lab's code, so a
different valid feature still passes a correct implementation.

**Signal:** eleven legs (0 to 4 and 6 to 11; the control is 5), each closing named rules (`specs/issues/FIX-1666/BUSINESS-RULES.md`):

0. opened without the ask: no request in the EM's session, no row; the held-out feature is in no
   lab code; the run is keyless *(AR-1, AR-7)*;
1. opened with the ask: the session listing, read as Inbox reads it (`GET /sessions?include=dispatch-runs`
   through the lab's door with its verified bearer), returns the EM seat's own session `s_eng_em`;
   its requests hold exactly one pending `human_approval` naming both held-out strings and allowing
   approve and reject; the feature mailbox declares the EM as a member; the board holds **no row**;
   nothing dispatched; the coder not reached *(AR-2, AR-3, AR-4)*;
2. Approve, through `POST /eng.em/requests/:id/resume`: first a resume with no bearer (401) and one
   with `submit` (409) are refused and it stays pending; then approve answers 202, the request
   completes, exactly one row (derived from the held-out slug) settles `completed`, handed to the
   coder seat by `workerId` and never to the reviewer, the coder reached once, nothing left pending
   *(AR-8, AR-9, AR-11, AR-13)*;
3. Deny, on a fresh open: the request completes, no row, no dispatch, the coder not reached, and the
   EM's message says nothing was filed *(AR-10, AR-11)*;
4. reopened over the same store while pending, after Approve, and after Deny: no second ask is
   raised and nothing new is filed *(AR-5)*;
6. an open that cannot raise the ask (a tree with no EM seat) fails, naming `raiseAsk` *(AR-6)*;
7. a row another door filed while the ask was pending: Approve files no second row, and the EM says
   the row already existed *(AR-12)*;
8. two raises racing over one store raise exactly one ask: the feature is claimed with the store's
   create-if-absent write *(AR-5)*;
9. a store that refuses a read fails the open, naming `raiseAsk` *(AR-6)*;
10. an ask left `interrupted` or `aborted` (nobody decided it) does not stop a reopen from asking
    again; only a pending or answered ask holds the feature *(AR-5)*;
11. an ask the run refused (it returned an error) fails the open naming `raiseAsk` and releases
    its claim, so a reopen asks again even when no request record is left *(AR-5, AR-6)*.

**Anti-game:** a hollow pass is an Inbox item that approves nothing, or an ask that was answered by
a lab helper rather than by the route Shift Manager takes. So every read a person's client would make goes
through the lab's HTTP door with its verified bearer; the answer goes only through the engine's
resume route; rows are **enumerated**, never looked up by the id this check expects; and "the coder
started" is graded on the dispatch record by `workerId` and on the stub being reached, not on the
row's status alone.

**Controls:** `GOAL_CONTROL=list` prints them.

| Control | Perturbs | Goes red on |
|---|---|---|
| `no-gate` | the asking door files before it suspends | leg 1, "a row existed before any approval" (and legs 3 and 4c, a row after Deny) |

**Model:** n/a (model-free by design; no key is read).

**Run:** `pnpm tsx goals/devforce-lab/it-waits-for-a-person-before-it-files/run.mts`

Needs `git` and a writable temp directory. No network, no model credential.

## What this establishes, and what it does not

It establishes that the lab's tree can raise an approval that a person's client finds where Inbox
reads, that answering it through the engine's resume route decides whether real DevForce work
starts, and that the ask is raised once per feature per store. It does **not** establish that App
Lab draws the card: that is the shell's own check. The other checks do not ask for the ask and
run as before.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | after b212e2187 | n/a | PASS | Bugbot fix: `raiseAsk` releases its claim when the run returns an error, as well as when it throws. Leg 11 opens with an empty goal, so the run refuses it; the request record is then deleted and the lab reopened. It FAILs on the previous `ask.mts` with "a reopen raised nothing … holds the claim and is still starting", and PASSes with the fix. `no-gate` still FAILs on leg 1. The four other devforce-lab checks PASS on the same tree. |
| 2026-09-30 | merge of main 2ce1bf7f9 | n/a | PASS | After FIX-1667 moved the board onto the feature mailbox. The row is now `eng.feature.work/night-mode-toggle--implement`, in org storage. Legs 8 to 10 were added for review. Two raises racing over one store raise one ask, a store that refuses a read fails the open naming `raiseAsk`, and an interrupted or aborted ask doesn't stop a reopen from asking again. Before the merge, each of the three failed on the previous `ask.mts`. `no-gate` FAILs on leg 1 "a row existed before any approval". On the same head the four other devforce-lab checks PASS: `it-wakes…`, `it-keeps…`, `it-commits…` and `it-ships…`, the last now that the reread fix is on main. |
| 2026-09-30 | cf92e03e7 | n/a | PASS | All eight legs green, keyless. `GOAL_CONTROL=no-gate` FAILs on leg 1 "a row existed before any approval: devforce-tasks--t0--feature/night-mode-toggle--implement", and on legs 3 and 4c (a row after Deny). Same commit: `it-wakes-the-seat-a-file-declared` PASS, `it-commits-from-the-seats-own-file` PASS; `it-ships-an-artifact-a-person-can-open` FAILs on "a fresh process read 0 transcript line(s)", which fails identically on `origin/main` (1590fb9f1) without this change. |
| 2026-10-01 | a25134ebd+wip (FIX-1691/1692) | n/a | PASS | All legs green, keyless. Same head: `it-keeps-its-rows-on-the-mailboxes-board` PASS. |
| 2026-10-08 | `865abc573` + FIX-1788 P4 | n/a | FAIL (control) | `no-gate`: legs 1, 3, 4c and 10 (a row before any approval). |
| 2026-10-08 | `865abc573` + FIX-1788 P4 | n/a | PASS | The ask raised in `s_eng_em`, a session on `em` naming the EM; answered through `em`'s resume route; approve filed one row handed to `eng.coder` by worker id; deny filed nothing. |
| 2026-10-08 | fix/closure-children-one-copy (main 0f569d032) | n/a | PASS | Leg 6's tree without the EM also drops it from the chief of staff's `delegates:`: an installation refuses a standard worker that delegates to one it doesn't have (FIX-1791 P1). Before, leg 6 failed "the open failed without naming the step: createWorkerInstallation: …". `no-gate` FAILs on leg 1 (and 3, 4c and 10). |

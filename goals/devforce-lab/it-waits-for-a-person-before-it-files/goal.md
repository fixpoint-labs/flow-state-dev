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

**Signal:** eight legs, each closing named rules (`specs/issues/FIX-1666/BUSINESS-RULES.md`):

0. opened without the ask: no request in the EM's session, no row; the held-out feature is in no
   lab code; the run is keyless *(AR-1, AR-7)*;
1. opened with the ask: the session listing, read as Inbox reads it (`GET /sessions?include=dispatch-runs`
   through the lab's door with its verified bearer), returns the EM seat's own session `s_eng_em`;
   its requests hold exactly one pending `human_approval` naming both held-out strings and allowing
   approve and reject; the feature channel declares the EM as a member; the board holds **no row**;
   nothing dispatched; the coder not reached *(AR-2, AR-3, AR-4)*;
2. Approve, through `POST /eng.em/requests/:id/resume`: first a resume with no bearer (401) and one
   with `submit` (409) are refused and it stays pending; then approve answers 202, the request
   completes, exactly one row (derived from the held-out slug) settles `completed`, handed to the
   coder seat by `flowId` and never to the reviewer, the coder reached once, nothing left pending
   *(AR-8, AR-9, AR-11, AR-13)*;
3. Deny, on a fresh open: the request completes, no row, no dispatch, the coder not reached, and the
   EM's message says nothing was filed *(AR-10, AR-11)*;
4. reopened over the same store while pending, after Approve, and after Deny: no second ask is
   raised and nothing new is filed *(AR-5)*;
6. an open that cannot raise the ask (a tree with no EM seat) fails, naming `raiseAsk` *(AR-6)*;
7. a row another door filed while the ask was pending: Approve files no second row, and the EM says
   the row already existed *(AR-12)*.

**Anti-game:** a hollow pass is an Inbox item that approves nothing, or an ask that was answered by
a lab helper rather than by the route App Lab takes. So every read a person's client would make goes
through the lab's HTTP door with its verified bearer; the answer goes only through the engine's
resume route; rows are **enumerated**, never looked up by the id this check expects; and "the coder
started" is graded on the dispatch record by `flowId` and on the stub being reached, not on the
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
Lab draws the card: that is the shell's own check. The three older checks do not ask for the ask and
run as before.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-30 | cf92e03e7 | n/a | PASS | All eight legs green, keyless. `GOAL_CONTROL=no-gate` FAILs on leg 1 "a row existed before any approval: devforce-tasks--t0--feature/night-mode-toggle--implement", and on legs 3 and 4c (a row after Deny). Same commit: `it-wakes-the-seat-a-file-declared` PASS, `it-commits-from-the-seats-own-file` PASS; `it-ships-an-artifact-a-person-can-open` FAILs on "a fresh process read 0 transcript line(s)", which fails identically on `origin/main` (1590fb9f1) without this change. |

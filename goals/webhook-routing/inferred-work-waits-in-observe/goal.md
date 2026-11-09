# webhook-routing › inferred work waits in observe

**Issue:** FIX-2538 (epic FIX-2471)
**Outcome:** An event no subscription heard reaches a coordinator that follows its thread for unheard events, when the app forwards its kind. The work it infers runs only in `auto`, waits on the user's yes in `observe`, and spends no token in `off`. An addressed event (one that asks the app's agent) runs in every mode. The service flow files no task.
**Input:** Seven normalized GitHub events on `acme/api`, inline in `run.mts`: an inferred issue; an issue that addresses the app's agent; a comment on #412 that alice's ordinary follower hears; a review (a kind the app doesn't forward); an outsider's issue; an inferred issue its turn files three ways (plainly, with its own `held: true`, and as a step for itself); and a second addressed issue. The app forwards `issue` and `comment`. Two users: alice runs three coordinators on the repo, `unmatched`, one per mode (`observe`, `auto`, `off`); bob runs one in `observe`. Held-out: the oracle in `run.mts` reads only each event's role in the fixture (which are forwarded, how many are dropped, which are asks) and imports no routing or screen code.
**Signal:** All of them, on one run:
- **(a)** 0 board tasks in the service principal's cell;
- **(b)** `observe`: every task a forward filed on an inferred turn holds one open confirm and started no attempt, for both users; the Inbox built from those tasks reconciles green (`reconcileInbox`);
- **(c)** `auto`: the same inferred tasks ran, and as many were filed as in `observe` (a filing the model held itself, and a step, set aside);
- **(d)** `off`: 0 model calls on an inferred forward; the addressed events ran in every mode, for both users;
- **(e)** a forwarded kind whose screen failed or held reaches no unmatched coordinator: **not run end to end.** No screen on this branch can fail or hold; FIX-2537's evaluator is the first that can. The rule (`refusedOnContent`, the pinned `interest: unjudged` and `<screen>: failed` reasons) is unit-tested in `packages/workforce/test/subscriptions-unmatched.test.ts`;
- **(f)** the comment alice's follower heard, the unlisted kind and the outsider reached no coordinator; routing counted as many drops as the fixture holds; alice's desks hold exactly the oracle's forwards;
- **(g)** every task filed on an inferred `observe` turn carries the confirm, whichever way it was filed; the step for itself is refused, so no unconfirmed work runs in that request.

**Anti-game:** the scripted model files with `questions: []`, so a confirm on a task is the board's, never the model's. Every assertion reads stored state (board tasks and their holds, the delegate's recorded attempts, messages); none reads a tool call. The off desk's model calls are counted at the model, by the forward each one read.
**Model:** n/a (scripted judgment turn and scripted fit check; no live model)
**Run:** `pnpm tsx goals/webhook-routing/inferred-work-waits-in-observe/run.mts`
**Controls:**
- `GOAL_CONTROL=no-gate` patches the board's write to add no confirm. Must FAIL **(b)** and **(g)**: inferred tasks hold no confirm, and the plain ones run.
- Today's `main` (no forwards at all) fails **(c)** and **(d)**: nothing is forwarded, so nothing is filed. Not scripted as a control: on `main` the coordinator has no `subscribe` action, so the run stops at its setup.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-09 | FIX-2538 branch + goal | n/a | PASS | 17 tasks across 2 users and 4 desks; observe's 3 inferred tasks per user each held one confirm and ran none; auto's 2 ran; the off desk called no model on an inferred forward; 2 addressed events ran in every mode; 2 drops counted; 12 forwards for alice's 3 desks. (e) not run. |
| 2026-11-09 | FIX-2538 branch + goal | n/a | FAIL (expected) | `GOAL_CONTROL=no-gate`: (b) every inferred observe task held 0 confirms and the plain ones started an attempt, for both users; (g) both multi tasks held 0 confirms. Nothing else. |

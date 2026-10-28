# harness-manager › a run's changes wait for review

**Issue:** FIX-2163 (epic FIX-2152). Its spec's goal: `specs/issues/FIX-2163/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** with `reviewChanges` on, a coding run that ends with commits waits for a person's review before its task completes. The judge's verdict is in the review as information. An accept completes the task with no further run; a request for changes carries the words into the same coding session on the same try; nobody answering before the host's deadline completes it marked as not reviewed.

**Input:** the DevTeam Lab, opened through `openLab` with `reviewChanges: true` on a durable SQLite store, served over HTTP with the Lab's verified bearer, trace observability off (`FSDEV_TRACE_OBSERVABILITY=0`, set before anything reads it). A conversation with the chief of staff files one task for the coder (`eng.coder`) on the Storefront project, a scratch repository. The chief of staff's turn is scripted; the coder's harness is the DevTeam stub, scripted per leg to commit, commit nothing or fail; Jev, the judge, is scripted through the model resolver's evaluation hook to answer *done* (or *ask*, leg i). `fixtures/input.json`, held out: the goal, the file and the commit subjects the stub writes, the revision's words, and the judge's confidence. Any of them pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`. The task is read through the board's `getTask`; the review through the row's question of the run's stop (`questions[]`, `source.kind: "suspension"`, `ask.kind: "review"`), which is how FIX-2129 shipped the mark the spec calls `waitingOn: "user"` / `waitingFor`.

- `a`: `a:waits` the task is `in_progress` with an open review question; `a:prompt` its prompt holds the commit count, the subject, and the judge's verdict and confidence; `a:inbox` Shift Manager's Inbox lists one review item for it; `a:attempt-1-no-lease`; `a:checkout-free` the checkout's lock is gone; `a:one-run`.
- `b`: accepted through the Inbox client. `b:accepted` completed, output `review: "accepted"`; `b:no-run` still one harness run; `b:item-closed`.
- `c`: the host is closed and opened again on the same store between the stop and the revision. A request for changes with the fixture's words, through the Inbox client: `c:reviewed-again` one more run commits and the task waits on a review naming 2 commits; accepted: `c:attempt-1`, `c:completed` (`review: "accepted"`), `c:two-runs`, `c:same-session` run 2 resumed the session run 1 confirmed, `c:the-words` run 2's prompt carries the words.
- `cprime`: run 1 confirms no session. A request for changes: `cprime:try-failed` the task goes to attempt 2, `cprime:next-brief` try 2's brief carries the words.
- `d`: `d:no-review` a run with no commits completes, `review: null`, no hold.
- `e`: `e:no-review`, `e:try-failed` a failed run fails its try with no review.
- `f`: `userDeadlineMs` 1,500, the sweep every 200 ms. `f:deadline` the task completes with `review: "deadline"`; `f:no-run` one harness run. With the setting unset, `f:no-deadline` the task still waits on its review after ten sweeps, one run.
- `g`: cancelled through the board's `updateTask` while it waits. `g:closed` cancelled, no questions; `g:no-run`; `g:branch-commit` the checkout's last commit is the run's; `g:kept-files` the file it kept in `project/` is saved; `g:item-closed`.
- `h`: `reviewChanges` off. `h:as-before` completes on the verdict, `review: null`.
- `i`: Jev answers *ask* (0.9, over the floor). `i:question` the task holds a question (FIX-2132), with no review.

**Anti-game:** every answer goes through orchestration's Inbox client, as Shift Manager's Inbox sends it, over the engine's answer route; the Inbox is Shift Manager's own snapshot (`createLabReader().read().inbox`) over HTTP; the task is read through `getTask_tasks`, never a store write. The harness slot is wrapped only to record what each run was handed and which session it confirmed (and, for leg c′, to keep run 1's session from the manager). Run counts are the slot's own record, not items. Leg c restarts the host, so the revision's run is the real resumed chain, not an in-memory continuation. Traces are off.

**Model:** n/a (model-free: the DevTeam stub and a scripted Jev).

**Run:** `pnpm tsx goals/harness-manager/a-runs-changes-wait-for-review/run.mts`. `GOAL_LEGS=a,b,c,cprime,d,e,f,g,h,i` runs some legs.

**Controls:** scratch patches to `packages/harness-manager/src/manager.ts`, applied as it loads, printed by the run, and refused when they never reached the code.

- `GOAL_CONTROL=no-review`: the review step passes every run through (the option ignored). Runs leg a. Must fail **`a:waits`**.
- `GOAL_CONTROL=fail-on-revise`: a revision always fails the try, as if no session were confirmed. Runs leg c. Must fail **`c:attempt-1`**.

Before this change the manager has no `reviewChanges` option and no `waitForUser`, so leg a fails as under `no-review`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | claude/project-thread-qq5f1t (working tree) | n/a | PASS | All legs. a: waiting on a review naming 1 commit, its subject and "The judge: done (0.86)", one Inbox item, attempt 1, checkout free, one run. b: accepted in the Inbox, `review: "accepted"`, one run. c: across a host restart, run 2 resumed `sess_stub_1` on attempt 1 with the words, reviewed again on 2 commits, accepted. c′: no session confirmed, try 1 failed, try 2's brief had the words. d: no commits, `review: null`. e: failed run, try failed, no review. f: `review: "deadline"` at the host's 1.5 s, no run; unset, still waiting after ten sweeps. g: cancelled, review closed, no run, commit and kept file stayed. h: option off, `review: null`. i: the judge's ask held a question |
| 2026-10-28 | claude/project-thread-qq5f1t (working tree) | n/a | FAIL (each control, as required) | `no-review`: `a:waits` (completed with no hold). `fail-on-revise`: `c:attempt-1` (attempt 2) |

# shift-manager › a coding run's question is answered in the Inbox

**Issue:** FIX-2132 (epic FIX-2058). Its spec's goal: `specs/issues/FIX-2132/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a coding run that needs a person's answer shows its question in the Inbox, and the answer carries the work on in the same coding session, on the same try, with no finished work run again.

**Input:** the DevTeam Lab, opened through `openLab` on a durable SQLite store, served over HTTP with the Lab's verified bearer, trace observability off (`FSDEV_TRACE_OBSERVABILITY=0`, set before anything reads it). A conversation with the Shift Coordinator files one task for the coder (`eng.coder`, the harness manager's answer phase) on the Storefront project, a scratch repository. The Shift Coordinator's turn is scripted; what is graded is the coder's run and the task. `fixtures/input.json`, held out: the real run's brief (read a code from `NOTE.txt`, ask, then write it to `resume-proof.txt` and commit) and the answer, and the stub legs' questions, answers and lines. Any question and answer pass the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a` (real model): the run asks. `a:held`: the task is held on a question (running, a row hold). `a:one-item`: Shift Manager's Inbox lists exactly one item for it. `a:the-runs-question`: that item's one hold is a `question` whose text is what the run wrote to its question file. `a:attempt-1-no-lease`: `getTask` shows attempt 1 and no lease. `a:checkout-free`: the checkout's lock file is gone. `a:reconciler`: FIX-2133's `reconcileInbox` is green.
- `b` (real model): answered through the Inbox client. `b:same-attempt`: the task stays on attempt 1. `b:same-session`: the answer's run resumes the session the first run confirmed. `b:the-fact`: `resume-proof.txt` in the checkout holds the code only the first run read (`NOTE.txt` is put in the checkout before the first run and taken away after it). `b:no-prompt-twice`: no run is handed a prompt an earlier one was. `b:completed`, `b:item-closed`, `b:reconciler`.
- `b2` (stub): a second question in the same try, the same way: each held, answered in the Inbox, three runs on attempt 1, each resuming the session the run before it confirmed, the third prompt carrying both answers oldest first.
- `r1` (stub): a line typed in the run's session (the coder flow's `respond`) while the task holds answers its question: exactly one more run, on attempt 1, resuming the confirmed session, carrying the line; the item closes.
- `r2` (stub): a line typed while a run works is taken by one more run of the same request, on attempt 1, resuming the session. The DevTeam's coder does not stop a step on abort, so the run ends on its own and the next step takes the line; with `stopsOnAbort` the step would be stopped instead (FIX-2086, its own specs).
- `r3` (stub): cancelled through the board's `updateTask` while it holds: the task is cancelled, no further run starts, the commit the run made stays on its branch, and the file it kept in `project/` is saved.
- `sweep`: no code reference, in package or lab source, to `answerQuestion`, `inboxCollection` (both in harness-manager, the conductor lab and Shift Manager, where they meant the removed inbox), `parkOnBoardQuestion`, `announce` (save the refusal that names it), harness-manager's `holdTaskForUser` and its inbox module, and in `harness-manager` to `awaitReview`, `HarnessRunParked` and `suspendForUser` (save the review step's one call, FIX-2163).

**Anti-game:** the Inbox is Shift Manager's own snapshot (`createLabReader().read().inbox`) over HTTP; every answer goes through orchestration's Inbox client, or the board's `updateTask` and the run's session door as a screen sends them; the task is read through `getTask_tasks` and `listTasks_tasks`, never a store write. The harness slot is wrapped only to record what each run was handed and confirmed, and, for leg b, to put `NOTE.txt` in the checkout before the first run and take it away after it. Before the answer, the checkout is swept for the code; the answer and the answer's prompt must not carry it. Traces are off.

**Model:** real — Claude Code's own, through the Agent SDK, for legs `a` and `b` only. The other legs run the DevTeam's harness stub. With no Claude Code account, legs a and b read nothing and the run says CAN'T TELL; it never falls back to the stub.

**Run:** `pnpm tsx goals/shift-manager/a-coding-runs-question-is-answered-in-the-inbox/run.mts`. `GOAL_LEGS=a,b,b2,r1,r2,r3,sweep` runs some legs. `GOAL_SWEEP_REF=origin/main` sweeps a git ref instead of the working tree. Legs a and b need a signed-in Claude Code Agent SDK or an Anthropic key.

**Controls:** scratch patches applied as the code loads, printed by the run, refused when they never reached the code.

- `GOAL_CONTROL=new-attempt`: both ways an owed turn starts (the board's claim, and the admission that takes it) count it as a new attempt. Must FAIL **`b:same-attempt`**, and on the stub legs **`b2:same-attempt`**, **`r1:same-attempt`**.
- `GOAL_CONTROL=fresh-session`: the manager's resume feed answers no session. Must FAIL **`b:same-session`**, and on the stub legs **`b2:same-session`**, **`r1:same-session`**.

`origin/main` before this change fails the sweep (`GOAL_SWEEP_REF=origin/main`: 8 of 9 names), and parks the run's question off the Inbox (leg a).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-26 | fix/fix-2132-coding-question (working tree) | n/a (stub) | PASS | `GOAL_LEGS=b2,r1,r2,r3,sweep`. b2: two questions, three runs on attempt 1, each resuming the last. r1: a line in the run's session answered it, one more run. r2: a mid-run line taken by one more run. r3: cancelled while held, no further run, the commit and the kept file stayed. sweep: 9 names, no references |
| 2026-10-26 | fix/fix-2132-coding-question (working tree) | n/a (stub) | FAIL (each control, as required) | `new-attempt`: `b2:same-attempt`, `r1:same-attempt` (attempt 2; the turn never ran, so the legs' other assertions fail too). `fresh-session`: `b2:same-session`, `r1:same-session`, and nothing else |
| 2026-10-26 | origin/main 6266ae832 | n/a | FAIL (expected) | `GOAL_LEGS=sweep GOAL_SWEEP_REF=origin/main`: 8 of 9 names still referenced |
| 2026-10-26 | fix/fix-2132-coding-question (working tree) | Claude Code (Agent SDK) | CAN'T TELL (blocked) | `GOAL_LEGS=a,b`: no Claude Code account in this environment (`probeClaudeAccount`: "Claude Code did not report an account within 10000 ms"; with the full environment, "Claude Code found no API key and no sign-in"). Legs a and b still need a real-model run |

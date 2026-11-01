# harness-manager › a tool call waits for approval

**Issue:** FIX-2389 (epic FIX-2369). Its spec's goal: `specs/issues/FIX-2389/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** with `approveTools` on, a coding run stops at a tool call that isn't already allowed and waits on the person as a task they can see and answer. Allow, Deny and Allow for this run reach the same coding session, also after a server restart. No call runs that nobody allowed.

**Input:** the DevTeam Lab, opened through `openLab` with `approveTools: true` on a durable SQLite store, served over HTTP with the Lab's verified bearer, trace observability off (`FSDEV_TRACE_OBSERVABILITY=0`, set before anything reads it). A conversation with the Shift Coordinator files one task for the coder (`eng.coder`) on the Storefront project, a scratch repository. The Shift Coordinator's turn is scripted and Jev answers *done*. The coder's harness is the package's stub with two scripted tool calls: a shell command that writes a marker file, then an edit to a file. `stopsOnAbort: true` is passed because the recording wrapper (a sequencer) hides the stub's own. `fixtures/input.json`, held out: the goal, the marker, the edited file, the Deny's note, and leg r's task. Another command, or another file, passes the same way.

**Signal:** each failure is tagged `<leg>:<assertion>`. The task is read through the board's `getTask`; the approval through the row's hold of the run's stop (`holds[]`, `source.kind: "suspension"`, `ask.kind: "approval"`).

- `a`: `a:waits` the task is `in_progress` with an open approval; `a:prompt` it names `Bash`, the command and the run's folder; `a:inbox` Shift Manager's Inbox lists one approval item for it; `a:not-ran` the marker is absent; `a:attempt-1`; `a:one-run`.
- `c`: the host is closed and opened again on the same store, then Allow through the Inbox client. `c:same-session` the next step resumed the session the run that asked confirmed; `c:attempt-1`.
- `b`: `b:ran-after` the marker was written once, after the answer, and the harness's record shows the command allowed once; `b:edit-waits` the edit then waits on an approval naming its file; Allow for this run: `b:completed` completed on attempt 1, `b:three-runs` (the run that asked, then one step per answer), `b:edit-ran` the file is there.
- `d`: Deny through the Inbox with the fixture's note. `d:never-ran` the marker is absent and the command was never allowed; `d:told` the next step's prompt carries the note; `d:went-on` the run went on (its edit allowed) and completed on attempt 1.
- `r` (real Claude Code, `default` mode, only `Read` pre-allowed; run with `GOAL_LEGS=r`): `r:waits` and `r:prompt` waiting on an approval naming `Bash` and the command; `r:not-ran` the marker absent while it waits; across a restart and Allow, `r:same-session` the resumed session is the one that asked, `r:ran-after` the marker appears. The evidence records the answer-to-marker latency (the restart and resume D1 costs).

**Anti-game:** every answer goes through orchestration's Inbox client, as Shift Manager's Inbox sends it, over the engine's answer route; the Inbox is Shift Manager's own snapshot (`createLabReader().read().inbox`) over HTTP; the task is read through `getTask_tasks`, never a store write. What ran is the command's own marker file and the stub's record of each call's decision, never the manager's state. The slot is wrapped only to record each run's prompt, folder, resumed and confirmed session. Legs c and r restart the host, so the answer resumes the real chain. Traces are off. A typecheck line holds the feed's shape to `claudeCodeAgent`'s `onToolApproval`.

**Model:** n/a for a–d (model-free). Leg r runs real Claude Code with the host's own sign-in.

**Run:** `pnpm tsx goals/harness-manager/a-tool-call-waits-for-approval/run.mts`. `GOAL_LEGS=a,b,c,d` runs some legs (b and c share a's host); `GOAL_LEGS=r` runs the real-Claude-Code leg.

**Controls:** scratch patches, applied as the code loads, printed by the run, and refused when they never reached the code.

- `GOAL_CONTROL=no-approval`: the manager never hands the feed. Runs leg a. Must fail **`a:waits`**.
- `GOAL_CONTROL=grant-ignored`: `grantMatches` never matches (`packages/harness-manager/src/tool-approval.ts`). Runs legs a, b, c. Must fail **`b:ran-after`**.

Before this change the manager has no `approveTools` option and hands no feed, so leg a fails as under `no-approval`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-01 | fix-2389-impl (working tree) | n/a | PASS | Legs a–d. a: waiting on "Allow Bash?" naming Bash, `touch TESTED` and the folder; one Inbox item; unrun; one run. c: across a restart, Allow resumed `sess_stub_1` on attempt 1. b: the command ran once, after the answer; the edit waited and passed on Allow for this run; completed in 3 runs. d: denied with a note, never ran, the session was told, completed on attempt 1 |
| 2026-11-01 | fix-2389-impl (working tree) | n/a | FAIL (each control, as required) | `no-approval`: `a:waits` (completed with no hold; `a:not-ran` too). `grant-ignored`: `b:ran-after` (marker written 0 times; the re-issued command held again) |
| 2026-11-01 | fix-2389-impl (working tree) | Claude Code (host sign-in) | PASS | Leg r. Real Claude Code in `default` mode waited on Bash `touch APPROVED-MARKER` unrun; across a restart Allow resumed the session that asked and the marker appeared 3,113 ms after the answer; the task completed |
| 2026-11-01 | fix-2443 (working tree) | n/a | PASS; `grant-ignored` FAILS on `b:ran-after`, as required | A grant reaches a file or command alone, any other call by its whole arguments, and the approval states the reach. Legs a–d pass unchanged |

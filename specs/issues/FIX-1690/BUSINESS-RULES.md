# FIX-1690 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. The epic's rules (ER-n), FIX-1662's frame rules and FIX-1664's task
rules apply as written; these are the ones a turn adds. *Proved by* names the kind of check.

## The door

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A seat kind is hired | Its door is its one public action that declares `userMessage` and takes `{ message: string }`. The inventory's seat row names it, or says it has none | CI |
| BR-2 | A kind declares two such actions | The hire reports a problem naming both, and the seat is published with no door; nothing guesses | CI |
| BR-3 | The door is called | The engine writes the person's line into the target session as a user message item before the door's block runs (Core's `userMessage`). App Lab writes no item of its own (ER-15) | Goal check · static |
| BR-4 | The composer waits for delivery | It shows *delivered* only when the door's request is `completed` **and** the target session holds that request's user item. Until then it shows *sending*; the draft stays | Goal check under `optimistic-turn` |
| BR-5 | The door refuses (finished task, no resumable harness, not the run's owner, no run) | The request ends with a named refusal; the composer keeps the draft and shows the reason. The line stays in the session, followed by the refusal | CI |
| BR-6 | The caller is not the run's principal | Refused as the harness manager's `answer` refuses a foreign run, and as the engine refuses an unreachable session: the same not-found shape, no hint the run exists | CI |

## A turn into a coding run

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The task's row is `in_progress` with a linked run | The door keeps the turn durably, then stops the running request through the stop hook. The attempt ends parked *for a person's turn*, not failed | Goal check |
| BR-8 | The next attempt starts after a turn | It resumes the previous attempt's coding session id, and its prompt is the turns kept since the last attempt, oldest first, each marked as the person's words. The checkout is the same one, edits intact | Goal check under `fresh-session` |
| BR-9 | A turn stopped the attempt | The next claim's re-entry is discounted from the task's `maxAttempts`, as an abandonment is; the board's `maxTotalRetries` is already untouched by `unpark`. A genuine failure afterwards is charged as usual | Goal check · CI |
| BR-10 | Two turns arrive before the next attempt starts | Both are kept and both are in that attempt's prompt, in order; one stop | CI |
| BR-11 | The run finished in the moment between the read and the stop | The stop reports *already finished*. If the row settled, the door refuses per BR-5 (*the task finished before your message reached it*); if it re-pended, the turn is kept for the next attempt | CI |
| BR-12 | The row is `parked` on the run's own question | The turn is kept and folded into the attempt that follows the answer. It does not unpark the row; answering stays the ask's path (FIX-1671, the manager's `answer`) | CI |
| BR-13 | The row is `pending` and its link names an earlier attempt's run | The turn goes into that session and is kept for the next attempt; nothing is stopped | CI |
| BR-14 | The row is `pending` with no linked run (never started) | Refused: *this task hasn't started, so there's no session to write into* | CI |
| BR-15 | The row is `completed`, `errored` or `cancelled` | Send is disabled with *a finished task takes no message*; a door call that races it is refused per BR-5 | CI |
| BR-16 | The run's harness gave no coding session id, or can't resume one | Refused: *this run's harness can't continue with a message*. Applies to `claude-code/cli-remote`, which only dispatches | CI |
| BR-17 | A turn and an Interrupt meet | Interrupt wins: an attempt stopped by Interrupt follows FIX-1664 (the board decides), and a turn kept before it still reaches the next attempt, if the board runs one | CI |

## The three composers

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A task's composer sends | Into the session the task's link names, through the door of the kind that session's `flowId` records, never the board's flow | Goal check |
| BR-19 | `@worker` is typed in a workstream | The worker's rows on the channel's boards that are running, parked, or pending with a link. One → BR-18 for that task. Several → the composer asks which, naming each. None → Send disabled: *"<worker> has no task in this workstream to message."* The channel transcript gets nothing | Goal check |
| BR-20 | A sent `@worker` line is delivered | The stream shows a receipt, *sent into <task>*, linking to its Session, until the page reloads | CI |
| BR-21 | An Inbox reply is sent | Into the session the ask sits in, through that session's kind's door | Goal check (fixture seat) |
| BR-22 | The asking session's kind has no door | The reply box is disabled: *"<worker> takes no message. Answer its ask with Approve or Reject."* Approve and Reject are untouched | Goal check (DevForce's EM) |
| BR-23 | *Also post to the workstream* is shown | Disabled, with its gap line naming FIX-1474 | CI |

## Failure taxonomy

| Failure | What the person sees | What is written |
|---|---|---|
| Refused by the door (BR-5, BR-11, BR-14, BR-16) | The reason; the draft kept | The line and the refusal, in the session |
| Not the owner (BR-6) | *No such run*; the draft kept | Nothing beyond the engine's refusal |
| Network or server error | *Not sent*, with Retry; the draft kept | Whatever the store holds; *delivered* never shows without BR-4 |
| Stop hook finds the request on another process | Delivery waits for that process's next heartbeat, as abort does | The stop intent on the request record |

## Acceptance criteria this issue owns

- Every composer in App Lab that sends to a worker calls the one door, and nothing else writes a
  session item (ER-15; FIX-1663's Part 4, as amended by [the second fork](DECISIONS.md#open-inbox)).
- FIX-1663's a4 can put a token into `eng.coder`'s running task session and read the model's next
  step in that session.
- FIX-1664's composer gap and FIX-1662's `@worker` gap are gone from App Lab's gap registry.

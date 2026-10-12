# FIX-1870 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story once, and who publishes each specific. The prose is proposed reader-facing text;
`dispatchTask`'s parameter names are working names until FIX-1875's spec fixes them.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · replaces "Asking, and waiting for the answer"

> ### Giving another worker work
>
> A task tool such as `addTask` or `assignTask` records work and who owns it. The board decides
> when it runs. When you want another worker to start now, dispatch the task instead:
>
> ```ts
> dispatchTask({ task: { new: { title: "Draft the release note" } }, to: "writer" })
> ```
>
> The work starts at once. When it ends, you hear about it the same way you hear about any task
> you filed.
>
> If your next step needs the result, wait for it:
>
> ```ts
> dispatchTask({ task: { new: { title: "Which region is the outage in?" } }, to: "ops", wait: true })
> ```
>
> Your turn pauses until the task ends, then carries on with the task's output as the tool's
> result. Nothing holds a request open while it waits, so a server restart loses nothing. A wait
> has a time limit, five minutes unless you set one between 30 seconds and an hour. When it runs
> out, the task is cancelled. A worker you're waiting on
> can't stop to ask you a question; it answers with what it has, or fails.
>
> Only wait when the result changes what you do next. Otherwise let the task run and carry on.

## UPDATE · `apps/docs/docs/glossary.md` · the *Hand-off* row, and a new *Dispatch a task* row

> | **Dispatch a task** | orchestration | Start a task on another worker now, in a session of its own. How a recorded task starts depends on the board. On a conversation's board, a worker dispatches with `dispatchTask`, and a task recorded without it doesn't start until it is dispatched. On a board a drain runs, recording is enough: the drain starts each task when it claims it, and dispatches it when its assignee holds a `dispatcher()`. | Task, wait, dispatcher block |
> | **Hand-off** | orchestration | A session that was doing the work passes it to another session, mid-work. Delivering new work isn't a hand-off; it's dispatching a task. | Dispatch a task |

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| "Giving another worker work" above, replacing the ask section and the `waitForResponse` / `timeoutMs` table rows | FIX-1875, with the tool | This document; option table in FIX-1875's `DOCS.md` |
| `background-work.md` "Waiting for the answer" rewritten to point at the section above | FIX-1875 | Its `DOCS.md` |
| `coordinators.md` and `chief-of-staff.md`: the `handOff` tool replaced by `dispatchTask` | FIX-1872 | Its `DOCS.md` |
| `packages/orchestration/README.md`: the `waitForResponse` / `timeoutMs` section replaced by `dispatchTask` | FIX-1875 | Its `DOCS.md` |
| `packages/workforce/README.md`: the coordinator `handOff` section and the delivery ledger replaced by rows | FIX-1872 | Its `DOCS.md` |
| `coordinators.md`: a post that needs an answer is a task per delegate, fenced by the task row, one answer per delegate per post; a tell is a plain message | FIX-1872 | Its `DOCS.md` |
| The glossary rows above; every remaining use of "ask" or "hand-off" for delivering work, across `apps/docs` | FIX-1876 | This document, then its `DOCS.md` |

Publish each specific with its implementation. No unchanged page is copied here.

# FIX-1876 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing text, by destination. The shared story ("Giving another worker work") is
the epic's and FIX-1875 publishes it ([epic DOCS.md](../../epics/FIX-1870/DOCS.md)); this issue
publishes the glossary rows, renames the board's dispatch section, and rewords every remaining
page the sweep lists. Unchanged pages are not copied. Voice to watch: no em-dash chains, no
"seamless", and say *dispatch* the first time with what it does.

## UPDATE · `apps/docs/docs/glossary.md` · orchestration rows

Replace the *Hand-off* row; add *Dispatch a task* and *Wait* after *Dispatcher*:

> | **Dispatch a task** | orchestration | Start a task on another worker now. How a recorded task starts depends on the board. On a conversation's board, a worker dispatches with `dispatchTask`, and a task recorded without it doesn't start until it is dispatched. On a board a drain runs, recording is enough: the drain starts each task when it claims it, and dispatches it when its assignee holds a `dispatcher()`. | Task, wait, dispatcher block |
> | **Wait** | orchestration | What a caller does on a task it dispatched when its next step needs the result: its turn pauses until the task ends, then carries on with the task's output. A wait has a time limit, and nothing holds a request open while it lasts. A board's `onIdle: "wait"` is a different setting: the board stays alive when it has nothing to do. | Dispatch a task |
> | **Hand-off** | orchestration | A session that was doing the work passes it to another session, mid-work. Giving another worker new work isn't a hand-off; it's dispatching a task. | Dispatch a task |

And in the *Delegation* row, "a hand-off to a worker on your roster" becomes "giving work to a
worker on your roster".

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "Assignees that hand off" becomes "Assignees that dispatch"

The heading keeps its old anchor, so links from elsewhere still land:

> ## Assignees that dispatch {#assignees-that-dispatch}
>
> <a id="assignees-that-hand-off"></a>
>
> An assignee in the registry normally runs its tasks inline: the drain claims a row, runs the
> worker, records the result, claims the next. An assignee can instead **dispatch** each claimed
> row to a **dispatch run** and move on. The drain finishes with the row still `in_progress`, and
> the run settles it when the worker is done.
>
> An assignee dispatches when it holds a `dispatcher({ action, session })` instead of a worker
> block. […the rest of the paragraph and the example as today…]
>
> This is the drain dispatching a row it claimed. It isn't the `dispatchTask` tool, which a board
> a drain runs doesn't offer: the drain decides when each task runs. For a worker that wants
> another worker to start now, see [Giving another worker work](#giving-another-worker-work).

The link lands on FIX-1875's "Giving another worker work", which replaces "Asking, and waiting for
the answer" on this page. The paragraph goes after the example, before the subsections.

In the same page:

> - `"dispatched"` — every task still outstanding is running in a dispatch run. The board
>   finished its own part and the work continues in the background, so this is a success, not a
>   stall. Only a board with an [assignee that dispatches](#assignees-that-dispatch) reports it,
>   and `counts.in_progress` is how many are still running. A log written before this release
>   says `"handed-off"` for the same thing.

> `board.dispatchers` lists the dispatcher assignees in declaration order, […as today…]
>
> The drain's final `task-board-meta` item reports `terminationReason: "dispatched"` when every
> outstanding task is running in a dispatch run […]
>
> The dispatch block itself returns `{ dispatched: true, taskId, sessionId, requestId, adopted }`
> […]. Don't read `sessionId` as an id for this dispatch. […]

Every other "hand off" in the page (the `"parked-for-review"` bullet's comparison, the
`onError` paragraphs, the example block names `hand-off-implement` and `hand-off-triage`, which
become `dispatch-implement` and `dispatch-triage`) follows the same word.

## UPDATE · `apps/docs/docs/server/background-work.md` and `apps/docs/guides/background-work.md`

Link text "Workers that hand off" becomes "Assignees that dispatch", pointing at
`#assignees-that-dispatch`. The example block name `hand-off-investigate` becomes
`dispatch-investigate`. In the provenance example, `"block": "hand-off-implement"` becomes
`"dispatch-implement"` and "the board row on a task hand-off" becomes "the board row on a
dispatched task". The waiting paragraph is FIX-1875's rewrite; if any "ask" survives it, it
becomes "wait".

## UPDATE · `apps/docs/guides/keeping-a-flow-running.md`

> description: "How a flow starts without a person typing, and keeps working after the request
> that started it returns: webhooks, schedules, dispatched work, and what a queue-backed host
> refuses."

> The same option keeps schedule ticks and dispatched work running there.

> To get dispatched work's result back into the conversation that started it on any host, with
> retries, start the work with a `{ key }` […]. From your app, the client SDK's
> `listChildSessions` lists the sessions a conversation's dispatches started.

## UPDATE · `docs/architecture/dispatched-work.md` and the other architecture docs the sweep lists

Internal reference, same rule: "hands it off" becomes "dispatches it", "a task hand-off" becomes
"a dispatched task", "an asked row" becomes "a waited-on row". No structural change.

## UPDATE · package READMEs (`orchestration`, `core`, `engine`, `workforce`, `patterns`, `harness-manager`, `claude-code`, `bullmq`)

Each renamed export appears under its new name, per [the map](PLAN.md#pinned-names). Where a
README section is titled for hand-offs, it becomes "Dispatching a row" or "Waiting on a task" by
which family it describes.

## UPDATE · pending changesets

`.changeset/post-to-mailbox-tool.md` is removed (the tool it announces was removed before it
released); `routed-mailboxes.md` and `mailboxes-everywhere.md` drop the sentence that names it.

## Not changed

Shift Manager's pages and the glossary's *Ask*, *Inbox* and *Roster* rows (a question to a
person, which is now the word's only meaning); the chief of staff's "What asks first"
(an approval); dated blog posts.

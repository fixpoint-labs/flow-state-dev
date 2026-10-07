# FIX-1802 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Reader-facing prose this issue publishes in P3, reconciled against shipped names and refusal
wording first. FIX-1794's draft puts filing on the coordinators page and defers its "Splitting
work" section here; this issue moves filing to a page of its own, since any worker can file now,
and leaves the coordinators page a pointer. Voice: [`CLAUDE.md`](../../../CLAUDE.md) → "Writing
Style". Watch for: "task session" and "delegate" defined on first use, no issue numbers, no
em-dash as a connector.

## CREATE · `apps/docs/docs/workforce/filing-work.md`

Sidebar: `workforce/filing-work`, right after `workforce/coordinators` in `apps/docs/sidebars.ts`
(FIX-1791 adds that page after `workforce/built-in-worker`). Front matter `sidebar_label: Filing work`.

> # Filing work
>
> Some work is a question, and a post gets it answered. Some work has to be done: a change made,
> a report written, a run that takes an hour. For that, a worker **files a task**: a row on a
> board, handed to one of its **delegates**, the workers it is allowed to hand work to. The
> delegate works it in a new session of its own, a **task session**, and the worker that filed
> it hears how it ended.
>
> A worker files when one of its delegates can take a task. There's no switch to flip: who the
> worker hands work to decides it.
>
> ## Giving a worker the task tools
>
> ```md title="workforce/teams/eng/workers/em/WORKER.md"
> ---
> description: Leads the feature. Files the work, never does it.
> delegates: [eng.coder, eng.reviewer]
> ---
> ```
>
> `delegates:` is who works for this worker: the list a [coordinator](./coordinators.md) hands
> posts to, and the list the worker files tasks for. Each session starts from it, and you change
> one session's list with `addDelegate` and `removeDelegate`. A delegate has to be on the same
> user's roster.
>
> When at least one of a session's delegates can take a task, the worker gets the [task board](../orchestration/task-board.md)'s
> eight task tools in that session: `addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`,
> `cancelTask`, `updateTask` and `listTasks`. Your app can send the same eight as actions on any
> of that worker's sessions. A worker whose delegates only take posts, like a coordinator that
> routes questions, gets none of them, and the app's `addTask` on its session answers
> `no_delegation_board`. So does a worker with no delegates. Add a delegate that takes tasks
> mid-conversation and the tools appear on the next call; remove the last one and they go.
>
> The built-in worker and the coordinator flow carry the tools. On your own flow, give the tools
> to the block that runs the model, and add their actions and the board's entries to the flow:
>
> ```ts
> import { createTaskToolsCapability, taskToolActions } from "@flow-state-dev/orchestration"
> import { workerConfigSchema, sessionBoard, taskDelegates, sessionBoardEntries, files } from "@flow-state-dev/workforce"
>
> // the block that runs the model, with the tools only when the worker files:
> //   uses: [(ctx) => files(ctx) ? [createTaskToolsCapability(sessionBoard.resolve, taskDelegates)] : []]
> export const em = defineFlow({
>   kind: "em",
>   configSchema: workerConfigSchema().extend({ document: z.string() }),
>   actions: { ...taskToolActions(sessionBoard.id, sessionBoard.resolve, taskDelegates) /* , your own */ },
>   ...sessionBoardEntries,
>   // …
> })
> ```
>
> A flow that leaves them out gives its workers no task tools, whatever their delegates.
>
> ## Where the tasks go
>
> Every session of a worker that files keeps its own board: a conversation with you, a session another
> worker posted to, or a task session. A worker files onto the board of the session it is in,
> never another's. Two sessions of one worker never see each other's tasks.
>
> A worker that files from a session it was **posted** to still answers the post as usual. The
> tasks it filed report back to that session, not to whoever posted. If the result has to come
> back to you, file the work rather than posting it.
>
> ## Splitting a task
>
> A worker given a task can split it. It files the pieces on its own task session's board, for
> its own delegates, and its task waits until the last piece ends. Then its task completes with
> what the pieces returned, or fails naming the pieces that failed for good, and the session
> above hears it. Before the last piece's result settles the task, the worker gets a turn, so
> it can give a failed piece to someone else first.
>
> ```text
> your conversation ─ task ─▶ lead's task session ─ pieces ─▶ two task sessions
>                    ◀─ "completed, with both results" ─┘
> ```
>
> Every session in the chain is yours, and only your own workers appear in it.
>
> ## How far it goes
>
> A chain stops at **five boards deep**, counting your conversation's as the first, and at
> **100 tasks under one top task**, at every depth together, finished ones included. A filing
> past either is refused the way a full board refuses one, with `total_task_cap_exceeded`, and
> the worker does the piece itself or tells you. Each task is a session and at least one model
> turn, so a worker that splits at every level gets expensive fast; the limits are where it
> stops.
>
> If your jobs need more than 100 pieces, raise the cap with an option on `hireWorkforce`. The
> depth doesn't change.

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · FIX-1794's "Handing out tasks"

Replace its first paragraph and the sentence "The coordinator has the same verbs as tools, so it
files tasks on its own when you ask it for work" with:

> A post gets an answer. When work has to be done instead, a coordinator can file a **task** for
> one of its delegates that takes tasks. Filing works the same for every worker,
> so it has [a page of its own](./filing-work.md); what follows is how it looks from a
> coordinator.

FIX-1794's "Splitting work" subsection is not published there; it is the section above.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "What a WORKER.md says", after the `packages:` paragraph

> `delegates:` names the workers this worker hands work to. When one of them takes tasks, the
> worker gets the tools to [file tasks](./filing-work.md) for them. A worker on your own flow also
> needs the flow to carry the task tools.

## UPDATE · `packages/workforce/README.md` · after FIX-1794's paragraph on tasks

> Any worker can file tasks: a delegate that takes tasks in its `WORKER.md`'s `delegates:`, and
> Orchestration's task tools on its flow, `createTaskToolsCapability` on the model's block and
> `taskToolActions` in the flow's actions, over the session's board (the built-in `agent` and
> `coordinator` flows carry them). A task's worker can split it the same way, up to five boards
> deep and 100 tasks under one top task, a cap the app can raise on `hireWorkforce`. See
> [Filing work](../../apps/docs/docs/workforce/filing-work.md).

The task session's lookup key is `filingSessionId` everywhere (FIX-1791, FIX-1794 and this spec).

## Not changed

The task board page (`apps/docs/docs/orchestration/task-board.md`): the board itself doesn't
change, and FIX-1794's subsection on boards kept per conversation stands. FIX-1794 documents the
roster `taskToolActions` takes there.

## Publication ownership

This issue publishes the new page and the three updates above. The coordinators page and FIX-1794's
sections are FIX-1791's and FIX-1794's; this issue only replaces the paragraph named. FIX-1796's
glossary defines "filing" and "task session" from this page.

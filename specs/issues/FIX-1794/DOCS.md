# FIX-1794 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Reader-facing prose this issue publishes in P3, reconciled against the shipped names and refusal
wording first. S1's collection option is drafted here as `partitionBy`; P1 picks its final name
(the epic's D6 records only the shape), and the prose follows it. Voice: [`CLAUDE.md`](../../../CLAUDE.md) →
"Writing Style". Watch for: framework terms on first use ("task session", "partition"), no issue
numbers under `apps/docs/`, and no em-dash as a connector.

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · a section after "What it records"

The page is FIX-1791's. This section lands after it does.

> ## Handing out tasks
>
> A post gets an answer. Some work needs to be done instead: a change made, a report written, a
> run that takes an hour. For that a coordinator files a **task** on its conversation's board,
> for one of its delegates.
>
> ```ts
> const coordinator = createClient({ flowKind: session.flowKind, userId, baseUrl })
> await coordinator.sendAction(
>   "fileTask",
>   { goal: "Audit our dependencies' licenses", assignee: "researcher" },
>   { sessionId: session.id },
> )
> ```
>
> The coordinator has the same verbs as tools, so it files tasks on its own when you ask it for
> work. Either way the assignee has to be one of this conversation's delegates. Anyone else is
> refused with the same answer as a worker that doesn't exist. A task with no assignee goes to
> the conversation's only delegate; with several, it waits until you assign it.
>
> The task starts as soon as it is filed. `fileTask` returns first, and the delegate works the
> task in a new conversation of its own, its **task session**, which belongs to you like every
> other session your workers run. The delegate can run on any flow.
>
> ### Hearing how it went
>
> The conversation that filed a task hears once when it ends: completed, with what came back;
> failed for good, with the error; or stopped on a question. A failed attempt with attempts left
> just runs again. A coordinator that routes by judgment reads the result and decides what to do
> next. One with a fixed routing policy shows it as a line in the conversation.
>
> | Action | What it does |
> |---|---|
> | `listTasks` | This conversation's tasks, and nobody else's |
> | `reassignTask` | Gives a task that isn't running to another delegate. A waiting task moves and keeps its id; a failed one is carried on by a new task. It starts at once |
> | `cancelTask` | Cancels a task that isn't running |
>
> A running task can't be reassigned or cancelled. A piece of work can be reassigned three
> times; after that the coordinator has to tell you.
>
> To open the session working a task, look it up with the task's id:
>
> ```ts
> const run = await workforce.findWorkerSession({
>   worker: "researcher",
>   taskId,
>   coordinatorSessionId: session.id,
> })
> ```
>
> Name the conversation that filed the task. Two conversations can file the same task id for the
> same worker, and each finds only its own task's session.
>
> ### Splitting work
>
> *(Published only if the split ships in this issue, [Q](DECISIONS.md#q); otherwise the
> follow-up publishes it. Amended after merge: [FIX-1802](../FIX-1802/DOCS.md) publishes it, for
> any worker granted filing, not only a coordinator.)*
>
> A delegate that is itself a coordinator can split its task. It files the pieces on its own task
> session's board, for its own delegates, and its task waits until the last piece ends. Then it
> completes with what the pieces returned, or fails naming the pieces that failed, and the
> conversation above hears it.
>
> A chain stops five boards deep. A filing below that is refused, and the coordinator does the
> piece itself or tells you. Every session in a chain is yours, and only your own workers appear
> in it.
>
> **Two conversations, two boards.** Each conversation's board is its own. Running one never
> takes, shows or waits on another conversation's tasks, even with the same coordinator and the
> same delegates.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "Durable boards that survive across turns", a new subsection before "A board a mailbox holds"

> ### A board per conversation, worked on another flow
>
> A `session`-scoped board with `sharedToLineage: true` can hand rows off within its own flow.
> It can't hand them to another flow: a dispatch run on another flow starts a lineage of its own,
> so it never finds the row. A `user`-scoped board does cross flows, but then every session of
> that user shares one set of rows, and one conversation's drain takes another's tasks.
>
> To keep a board per conversation and still hand its rows to another flow, give a `user`-scoped
> collection a partition:
>
> ```ts
> const work = defineTaskCollection({
>   id: "work",
>   scope: "user",
>   partitionBy: (ctx) => conversationKey(ctx),   // from data only the server writes
> })
> ```
>
> Rows are stored at the user's scope, under the partition the running session's context
> returns. A board resolved in one session reads, claims, waits on and settles only its own
> partition, and so do its task tools. A seat that hands off puts the partition on the dispatch,
> and the run on the other flow reads its one row there, with every check a board's entry runs.
> Declare the same collection on the receiving flow and serve its task entry with `taskLedgers`;
> the ledger's `resolve` gets the partition with the ledger id.
>
> Return a value a caller can't set. A session's id is reused when a session is deleted and
> created again, so a partition built from the id alone hands the new session the old one's
> rows. Workforce partitions each coordinator conversation by a value minted when it was created.
> A partition function that reads the action's input is a bug: any caller could name another
> board.

And in "What the board requires", the `sharedToLineage` bullet becomes:

> - **A `session`-scoped collection declares `sharedToLineage: true`**, and its seats hand off
>   within this flow. To hand rows to another flow, use a partitioned `user`-scoped collection
>   ([A board per conversation](#a-board-per-conversation-worked-on-another-flow)). `org` scope
>   needs nothing extra.

## UPDATE · `packages/workforce/README.md` · the "Coordinators" section FIX-1791 adds, one paragraph after it

> A coordinator conversation also keeps a task board. `fileTask` files a task for one of its
> delegates, which starts at once in a task session of the delegate's; `listTasks`,
> `reassignTask` and `cancelTask` follow it, and the conversation hears when each task ends.
> `findWorkerSession({ worker, taskId, coordinatorSessionId })` finds a task's session. Chains
> stop five boards deep.
> See [Handing out tasks](../../apps/docs/docs/workforce/coordinators.md#handing-out-tasks).

## UPDATE · `packages/orchestration/README.md` · "Task board", after the durable-collection paragraph

> A `user`-scoped collection can take a `partitionBy` function, keeping one set of rows per
> partition, so each conversation has its own board that a seat can still hand off to another
> flow. See the task-board guide's "A board per conversation, worked on another flow".

## Not changed

`apps/docs/docs/workforce/mailboxes.md` and its "Holding a board" section stay until FIX-1792
converts the boards, which rewrites them. Shift Manager's Board view is FIX-1793's page; this
issue changes what the board reads, not what the page says.

## Publication ownership

FIX-1794 publishes these four operations in P3. The coordinators page and the Workforce README
section are FIX-1791's; this issue adds only the sections above. The epic's overview and
glossary, including "task session", are FIX-1796's.

# FIX-1817 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Reader-facing prose this issue publishes with its implementation, reconciled first against the
shipped names and refusal wording. Voice: [`CLAUDE.md`](../../../CLAUDE.md) → "Writing Style".
Watch for: "task session" introduced on first use, no issue numbers under `apps/docs/`, no
em-dash as a connector, and "ask" kept for the hand-off that waits (another page's word).

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · two sections after "Hearing how it went"

The page is FIX-1791's and "Hearing how it went" is FIX-1794's. These land after both.

> ### When a task stops on a question
>
> A delegate working a task sometimes can't go on without you: which region, which account,
> whether it may delete something. It parks the task on its question instead of guessing. The
> conversation hears it, with the question, and nothing runs while it waits.
>
> Answer it from the conversation:
>
> ```ts
> await coordinator.sendAction(
>   "answerTask_tasks",
>   { taskId, answer: "Use eu-west." },
>   { sessionId: session.id },
> )
> ```
>
> The coordinator has the same verb as its `answerTask` tool, so when you answer it in chat it
> passes the answer on. The task picks up in its own task session, the one that asked, with
> everything it did before it stopped. Your answer is its next message. When it finishes, the
> conversation hears that too.
>
> An answer doesn't use up the task's retries, and the task can ask again. A task waits on a
> question for as long as it takes; cancel it if nobody will answer. A second answer to the
> same question is turned away, and so is an answer to a task that isn't waiting on one.
>
> ### After a task finishes
>
> A finished task's session stays open. To ask it about the work, send a message to its worker
> in that session:
>
> ```ts
> const run = await workforce.findWorkerSession({ worker: "researcher", taskId, filingSessionId: session.id })
> await researcher.sendAction("run", { message: "Which sources did you rule out?" }, { sessionId: run.id })
> ```
>
> It answers from what it did. The task itself doesn't change: a finished task stays finished.
>
> To build on the work, file a follow-up task that names it:
>
> ```ts
> await coordinator.sendAction(
>   "addTask_tasks",
>   { goal: "Now write it up for the team", followUpOf: taskId },
>   { sessionId: session.id },
> )
> ```
>
> The follow-up is a new task with its own id, and the conversation hears how it ends. It runs
> in the same session as the task it follows, with the same worker, so it starts from
> everything that session already knows. The task it names has to be finished, and its session
> can work one task at a time.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "Which session a task runs in", a closing paragraph

The epic's shared sentence ([FIX-1815 DOCS](../../epics/FIX-1815/DOCS.md)), in its final form.

> A task keeps its session for its whole life. If its worker parks it on a question, the answer
> brings it back to that same session as its next message, so it carries on with everything it
> did before. When the task is done the session stays open: you can send its worker a message
> there, or file a follow-up task with `followUpOf`, which runs in the same session. The
> finished task itself never changes.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "Waiting on a person", a subsection after "Picking it back up"

> ### Answering through the task tools
>
> A board whose tasks run in their own sessions (handed off with a dispatcher) gets two more
> verbs with its task tools. A worker on a handed-off task has `parkOnQuestion`, which parks the
> task it is running on a question and ends its turn. Whoever can write the board answers with
> `answerTask`, or the `answerTask_<board>` action:
>
> ```ts
> await client.sendAction("answerTask_tasks", { taskId: "t-7", answer: "approved" }, { sessionId })
> ```
>
> It works like `unparkAndDrain`, with two differences. It starts the board in a request of its
> own instead of draining in yours, and the claim that follows isn't charged against the
> task's `maxAttempts`. It declines a task that isn't parked on a question, including one
> waiting on its own sub-tasks.

## UPDATE · `packages/orchestration/README.md` · task tools

> `answerTask({ taskId, answer })` answers a task parked on a question and starts its board.
> `addTask` takes `followUpOf` to run new work in a finished task's session. A handed-off
> worker gets `parkOnQuestion({ question })`.

## UPDATE · `packages/workforce/README.md` · tasks

> A task's session takes its answer, and stays open after the task finishes: message its worker
> there, or file a follow-up with `followUpOf`.

## Publication ownership

FIX-1817 publishes all of the above after V3 and V4 pass. The task-board paragraph is the
epic's shared text, owned here (epic DOCS "Ownership"). The ask section on
`background-work.md` is FIX-1816's and is not touched.

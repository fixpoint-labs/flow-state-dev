# FIX-1780 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Three updates to pages that exist and two README entries. No new page and no sidebar change: the
behaviour belongs under "Holding a board" on the mailboxes page, the board option belongs on the
task board page, and the built-in worker page gets a pointer. Write "worker", never "seat", in
every sentence added; leave the rest of each page's wording alone.

FIX-1779 adds the coordinator's `fileTask` tool to the same mailboxes section. The section below
goes after FIX-1779's text and assumes it.

## 1 · Update `apps/docs/docs/workforce/mailboxes.md` — new subsection after *Working the rows*, as FIX-1777 rewrites it

> ### Hearing how a task ended
>
> A worker that files a task usually wants to know how it went. When a worker files through its
> `fileTask` tool, the task remembers who filed it and which conversation the filing came from.
> When the task ends, that worker gets a turn in that conversation:
>
> ```text
> task hello-world on eng.feature/work ended: errored after 2 attempts.
> eng.coder: "npm install failed: no network"
> ```
>
> Three endings send one: the task completed, its last attempt failed, or the worker running it
> parked it on a question. A failed attempt that will be tried again sends nothing, and neither
> does a cancel.
>
> Because the turn runs in the conversation the task was filed from, its answer lands where the
> person who asked can read it. The notice runs even if that conversation is in the middle of a
> turn, the way a mailbox post does, so it is never dropped.
>
> Only a worker's filing is followed. A task filed by a client, a post, or your own host code has
> no filer, and nobody hears when it ends. Who filed is recorded by the runtime when the tool
> runs, so a tool call can't name somebody else's conversation. A filing that is refused never
> becomes a task: the tool says why in the same turn.
>
> The built-in `agent` kind hears these turns.
>
> If the delivery can't land (the worker was fired, or its kind has no `onTaskSettled`), it fails
> by name on the session that ran the task. The task itself is not affected.
>
> ### Reassigning and cancelling a task
>
> Two more tools let a worker act on what it heard:
>
> - `reassignTask` gives a task to another worker. A task that hasn't ended keeps its id and
>   moves to the new worker (a parked one goes back to waiting, and its question is withdrawn). A
>   task that failed stays failed, and a new task that names it is filed for the new worker. Either
>   way the list starts it. The new worker must be one the list would take a filing for. After
>   three moves of the same work the tool refuses, so a worker that keeps failing has to say so
>   instead.
> - `cancelTask` cancels a task with a reason, on any list. A worker that works one list already
>   has that list's own cancel tool; this one is for a worker that files across lists.
>
> Neither touches a task that is running. Wait for it to end, then act.

## 1b · Update `apps/docs/docs/workforce/mailboxes.md` — *Making a kind of your own hear posts*, one sentence at its end

> A kind hears the end of a task it filed the same way, by declaring an internal entry named
> `onTaskSettled`. See [Hearing how a task ended](#hearing-how-a-task-ended).

## 2 · Update `apps/docs/docs/orchestration/task-board.md`

In *What the board requires*, replace the sentence that begins "A board with any seat that hands
off fixes each task's assignee at admission" with:

> A board that hands tasks off fixes a task's assignee while an attempt holds it: `setAssignee`
> on an *in progress* or *parked* task declines with reason `immutable-assignee`. A pending or
> blocked task can change hands. To move a parked task, `unpark` it first. The rule belongs to the collection, so a second board over the
> same `defineTaskCollection` value follows it too.

Then, in *Concurrency and error handling*, a new short subsection:

> ### Running a step when a task ends
>
> `onTaskSettled` is a block the board runs after it records how an attempt ended, whether the
> attempt ran in place or was handed off to another flow. It receives the task as it now stands
> and one of `completed`, `errored` (no attempts left), `parked` or `retrying`. It is not run
> when the board could not record the result, or when a newer attempt owns the task.
>
> ```ts
> taskBoard({
>   name: "work",
>   collection,
>   workers,
>   onTaskSettled: tellWhoAsked,   // a block; a dispatcher works
> });
> ```
>
> Workforce uses it to wake the worker that filed the task.

## 3 · Update `apps/docs/docs/workforce/built-in-worker.md` — end of *Configuring the kind*

The page does not mention mailbox posts today. Add one paragraph:

> The kind hears two things besides a person's message: a post on a mailbox it belongs to, and
> the end of a task it filed. Each runs its ordinary answer as a turn. See
> [Waking members](./mailboxes.md#waking-members) and
> [Hearing how a task ended](./mailboxes.md#hearing-how-a-task-ended).

## 4 · READMEs

- `packages/workforce/README.md`: `reassignTask`, `cancelTask` and the `onTaskSettled` entry, one
  line each, in the mailbox section.
- `packages/orchestration/README.md`: the `onTaskSettled` board option, one line.

**Voice watch:** no em-dashes added; introduce *filer* only through "who filed it"; no "seamless".

## Not changed

- No engine contract changes, so `docs/architecture/dispatched-work.md` stays as it is.
- "What mailboxes do not do yet" has no line this removes.

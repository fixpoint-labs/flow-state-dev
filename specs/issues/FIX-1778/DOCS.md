# FIX-1778 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. Destinations are current files; the implementer reconciles each
against shipped behaviour before publishing. New prose says worker, never seat. Helper names
below are placeholders until the code names them.

## UPDATE · `apps/docs/docs/workforce/overview.md` · new section before "What it will not do"

## Giving a task to a worker

A task can name any of your workers, by the name `discover` shows: `eng.coder`, or `frontend`, a
worker hired a minute ago. When the task is handed over, Workforce looks the name up and sends
the task to that worker. The lookup sees a hire the moment it is made, so a coordinator can hire a
worker and give it work in the same conversation.

Every worker can take a task from any task list in your organization. A worker on the built-in
`agent` kind runs the task as one turn, with its own instructions and tools and the task's goal as
the message; its answer becomes the task's result. A kind you write takes tasks when it declares a
`work` task entry that reads its tasks from your mailboxes' lists:

```ts
import { mailboxLists } from "@flow-state-dev/workforce";

defineFlow({
  kind: "reviewer",
  task: { actions: { work: { block: review, from: mailboxLists() } } },
});
```

The lookup finds your organization's workers, and the workers the member who filed the task hired
for themselves. It never finds another member's own workers or another organization's. Filing a
task for a name nobody has is refused at once, naming the worker. A task whose worker was fired
before it ran fails with the worker's name in the error, and no one else runs it. Once filed, a
task's worker stays fixed.

Who may file a task on a list, and for whom, is decided where tasks are filed. A worker takes any
task its organization's lists hand it.

## UPDATE · `apps/docs/docs/workforce/overview.md` · "Workforce or orchestration"

Replace *"A task's `assignee` never names a hired worker."* with: *"A task's `assignee` can name
any of your workers, including one hired while the app runs. See
[Giving a task to a worker](#giving-a-task-to-a-worker)."*

## UPDATE · `apps/docs/docs/workforce/overview.md` · the two "does not staff a task board" bullets

Replace both with: *"It does not run your task lists. A list's board runs them; Workforce tells it
which worker a name means, and gives every worker a way to take a task."*

## UPDATE · `workforce-overview.svg`, `glossary/orchestration.svg`, and the overview's `alt` text

Replace *"A task board's assignee names a board worker, never a seat. Workforce does not staff a
board."* with *"A task's assignee can name any of your workers. The board runs the list; Workforce
finds the worker."*

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · new section "Taking a task"

An `agent` worker takes tasks from any task list in its organization. Each task runs as one turn in
a session of its own: the worker's instructions and tools, the task's goal and context as the
message. The answer is stored as the task's result and the task completes. If the turn fails, the
attempt fails, and the task's attempt budget decides whether it runs again. A task never writes to
a mailbox unless the worker's own tools do.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "What the board requires"

Replace the bullet *"The seat is a named registry entry…"* with: *"A uniform `workers` block can't
hand off. A named entry can, and so can `defaultWorker`, which hands off every task whose assignee
has no entry of its own (see below)."*

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · new subsection "Sending a task to a flow chosen per task"

A task dispatcher's `flowKind` can be a function instead of a string. The board calls it when it
hands a task over, with the task's assignee, id and input and the running context, and sends the
task to the flow id it returns. It may be async. Put such a dispatcher at `defaultWorker`:
assignees with their own entry keep it, and every other assignee is looked up.

```ts
taskBoard({
  name: "work",
  boardId: "support.help.work",
  collection: work,
  workers: { triage: dispatcher({ flowKind: "acme.support.triage", action: "work", session: "per-task" }) },
  defaultWorker: dispatcher({
    flowKind: async (task, ctx) => findFlowFor(task.assignee, ctx), // undefined when there is none
    action: "work",
    session: "per-task",
  }),
});
```

When the function returns nothing, or the task has no assignee, the hand-over is refused as
`flow-not-found`, naming the assignee, and the attempt fails through the board's ordinary error
path. Only `task` dispatchers take a function. Workforce's worker lookup is one such function: see
[Giving a task to a worker](../workforce/overview#giving-a-task-to-a-worker).

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · new subsection "A task entry served by many boards"

A task entry is normally reached by one board, which puts its claim check in front of it. An entry
can instead name where its tasks come from: `from`, a function from a board id to that board's
collection. Each arriving task is checked against the board it names, with the same checks (same
attempt, same row, still in progress, still for this assignee), and a board id `from` doesn't know
is refused before anything is read. No board on the flow has to reach the entry.

```ts
task: { actions: { work: { block: implement, from: (boardId, ctx) => ledgerFor(boardId, ctx) } } },
```

## UPDATE · `apps/docs/docs/orchestration/configuration.md` · `defaultWorker` row

`defaultWorker` · block or task dispatcher · omitted · Runs a task whose assignee has no entry of
its own, or has none. A task dispatcher here hands those tasks off, and its `flowKind` may be a
function. Omit it and a miss fails the task per `onError`.

## UPDATE · `apps/docs/docs/orchestration/agents.md` and `orchestration/overview.md`

- `agents.md`, "Hired workers": replace *"A task's `assignee` never names a hired worker."* with
  *"A task's `assignee` can name a hired worker; see Workforce."*
- `agents.md` and `overview.md`, Related pages: replace *"A hired worker is an address, not a board
  assignee"* and *"…an address you open a session against, not a board assignee"* with *"A hired
  worker is an address you open a session against, and a name you can give a task to."*
- `overview.md` line 34: replace *"Those seats are addresses you open a session against, not board
  assignees."* with *"Those workers are addresses you open a session against, and names a task can
  be given to."*

## UPDATE · `apps/docs/docs/workforce/mailboxes.md` · the `assignee` paragraph

`assignee` names the worker that should run the row, by the name `discover` shows. A board can
also declare its own names for workers in its `workers` map, which win. It is not a mailbox
member, and the two are separate namespaces even when they read alike.

## UPDATE · `packages/core/README.md` · dispatcher section

After *"A target chosen from data is a `router` over declared dispatchers, not a dynamic
string."* add: *"The exception is a `task` dispatcher's `flowKind`, which may be a function of the
task, checked when the task is handed over like any cross-flow address."*

## UPDATE · `packages/orchestration/README.md` and `packages/workforce/README.md`

The two orchestration subsections above, in the README's terse form. Workforce: the lookup, the
filing check, the list resolver and the `agent` task door, with signatures as shipped.

## Changeset

`minor` for `@flow-state-dev/core`, `@flow-state-dev/orchestration`, `@flow-state-dev/workforce`.

# FIX-1629 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Drafted by the spec author; this session could not dispatch `docs-writer`. The implementer runs
`docs-writer` then `docs-editor` over these drafts against what shipped, before publishing.
Quoted text is the proposed prose.

## UPDATE · `apps/docs/docs/devtool/overview.md` · "Task boards" (replace the section body)

> The Tasks tab lists the task boards the open session emitted. A task board is the queue a flow
> files work into for workers to claim. Each task is one row: its status first, then its goal,
> then a short note about it when there is one.
>
> Click a row, or focus it and press Enter, to open it in place. The open row shows everything
> the task carries: the full goal, attempts, assignee, priority, labels, the note and any error,
> input and output, metadata, revision and timestamps, and the dispatch run working it. The raw
> record is folded at the bottom if you want the JSON. Rows stay open while the task changes
> underneath them.
>
> The note is the task's `feedback` field. Parking a task for review records why it is
> waiting, or clears the note when you give no reason. A failure with retries left records the
> error and sends the row back to `pending`. Resuming a parked task writes the answer you hand
> it. The row shows whichever wrote last, and the note slot appears only on boards where some
> task carries one. A note is not an error: a failure with no retries left writes `error`.
>
> ### Changing a task from its row
>
> An open row lists the flow's actions that take a `taskId`. Pick one and its form opens in the
> row with the task's id filled in. Submit it and the DevTool runs the action exactly as the
> action bar would, in the session you are looking at. The row updates when the task changes.
>
> If the task can't move that way, say you cancel a task that already finished, the action
> refuses and the row shows why. Nothing is written.
>
> The DevTool changes tasks only through your flow's actions. There is no way to edit a
> task's record directly, which keeps every change going through the same checks a worker's
> would. If a row says the flow has no task actions, see
> [exposing task actions](/docs/orchestration/task-board#changing-tasks-from-outside-a-run).

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · new section after "Commanding the board with its capability"

> ## Changing tasks from outside a run
>
> Workers change tasks while a board drains. Sometimes a person needs to as well: cancel a task
> nobody needs, bump a priority, mark one failed. `taskToolActions` gives your flow the same
> eight task tools a model can hold, as actions any caller of the flow can run:
>
> ```ts
> import { taskBoard, taskToolActions } from "@flow-state-dev/orchestration/task-board";
>
> const board = taskBoard({ name: "todos", collection: todos, workers });
>
> defineFlow({
>   kind: "ops",
>   resources: { [todos.id]: todos },
>   actions: {
>     drain: { block: board.drain },
>     ...taskToolActions(board),
>   },
> });
> ```
>
> The actions are named for the board: `addTask_todos`, `assignTask_todos`, `completeTask_todos`,
> `failTask_todos`, `blockTask_todos`, `cancelTask_todos`, `updateTask_todos` and
> `listTasks_todos`. Each runs the same checked transition a worker's would, so a move the task
> can't make comes back as `{ ok: false, error }` rather than a write. None of them claims or
> drains the board.
>
> They are public actions. Anyone who can call your flow can call them, so add them only to a
> flow whose callers you trust with the board. The DevTool's Tasks tab offers them on each row.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Working the rows", after the paragraph on `channelBoardTaskTools`

> A channel can offer the same eight tools to callers, as actions. Add `boardActions: true` to
> its `CHANNEL.md`:
>
> ```md
> ---
> description: Ask the support team anything.
> members: [support.devices, support.accounts]
> boards: [escalations]
> boardActions: true
> ---
> ```
>
> Each board gains `cancelTask_support_help_escalations` and its seven siblings beside
> `fileTask` and `readBoard`. It is off by default because anyone who can reach the channel can
> then settle or reassign its rows, and `author` checks on filing don't apply to these. Turn it
> on for boards people are meant to work from outside, and for development.

And in "What the file is checked for": *"the closed list of six keys"* → *"seven"*.

## UPDATE · `packages/orchestration/README.md` · task-board exports

> - `taskToolActions(board)` — the eight task tools over `board`, as a flow `actions` map named
>   `<tool>_<board>`. Public actions; see the docs before exposing them.

## UPDATE · `packages/workforce/README.md` · channels

> - `CHANNEL.md` `boardActions: true` — expose each board's task tools as channel actions. Off by default.

## Changesets

`@flow-state-dev/orchestration` (minor: new export), `@flow-state-dev/workforce` (minor: new key),
`@flow-state-dev/devtool` (patch: Tasks tab).

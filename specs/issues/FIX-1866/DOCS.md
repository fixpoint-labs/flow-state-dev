# FIX-1866 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Reader-facing prose this issue publishes, reconciled against the shipped names first. The
manager's new option is drafted as `ledgers` and Workforce's resolver as `conversationLedgers`;
P1 and P2 pick the final names and the prose follows.
Voice: [`CLAUDE.md`](../../../CLAUDE.md) → "Writing Style". Watch for: "worker", never "seat";
no issue numbers under `apps/docs/`; no em-dash as a connector; introduce "conversation's board"
on first use on the harness page.

## UPDATE · `apps/docs/docs/orchestration/harness-manager.md` · a section after "What it does"

> ## Running tasks from more than one board
>
> A manager built with `boardCollectionId` works one board. A worker that also takes tasks a
> coordinator files in a conversation needs more: each conversation keeps its own board, so
> there is no single board to name.
>
> Give the manager `ledgers` instead. It's a function that finds a board by the id and
> partition the task's claim names, and returns `undefined` for any board the worker shouldn't
> read:
>
> ```ts
> import { harnessManager } from "@flow-state-dev/harness-manager";
> import { conversationLedgers } from "@flow-state-dev/workforce";
>
> const answering = harnessManager({
>   ledgers: conversationLedgers,
>   tenant: undefined,
>   phase: answerPhase(),
>   workspace,
>   runTimeoutMs: 30 * 60_000,
>   harness,
> });
> ```
>
> `conversationLedgers` is Workforce's: it finds the board of the conversation the task came
> from, for the person the run belongs to, and nothing else. The manager reads the board and partition from the claim, never from the task. Each run's
> checkout, branch and run record are kept apart by board and partition, so two conversations
> that file the same task never share a tree.
>
> A task from a conversation usually carries a goal and no `issue` or `phase`. The manager then
> uses the task's id in their place. A completed run's output carries the agent's last message
> as `answer` (up to 8,000 characters), the run's `branch`, or `null` when it worked on files,
> and how many `commits` it made.
>
> Two things work differently for a task from a conversation's board. A run refused before it
> starts (no project, a remote the host doesn't allow) fails the task for good, so the
> conversation hears why; on a fixed board it's cancelled, as before. And a question the run asks
> parks the task the way the conversation parks any task: the person answers in the
> conversation, and the run's next attempt gets the answer in its prompt.

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · "Taking a conversation's tasks"

Add a row to the options table, and a paragraph under it:

> | `block` | Instead of `turn`. A block that takes the task itself (`taskId`, `goal`, `context`, `input`, `attempts`), for a flow whose work isn't one message in and one answer out, such as a coding run. Give `turn` or `block`, not both. |
>
> A coding worker built on the harness manager uses `block`: the manager takes the task, works it
> in its own checkout, and returns the answer. The conversation hears it the same way.

## UPDATE · `apps/docs/docs/workforce/projects.md` · the `projectWorkspace` paragraph

Replace the paragraph after the example with:

> `projectWorkspace` finds the project a run works in, in this order:
>
> 1. The workstream the task came from, when it was filed from one.
> 2. The project the task came from, when it was filed from a project's conversation.
> 3. The project the task names in `input.project`, when it came from a conversation that
>    belongs to no project, such as the person's own coordinator.
> 4. The project holding the board's workstream, when you built it with `board`, as above.
>
> A task that names a project other than the one its conversation belongs to is refused.
> The run is also refused before any file is read when the person it belongs to isn't one of
> the project's members (`not-a-member`), or when none of the three finds a project
> (`no-project`). The host refuses a remote its `remotes.allow` doesn't list, naming it, before
> anything is cloned; list `"file"` to allow `file://` remotes. A refused run isn't retried, and
> the conversation that filed the task hears why.
>
> A coordinator filing for a coding worker from a conversation with no project names one:
>
> ```json
> { "goal": "Take a look at our repo and tell me what the checkout flow does", "assignee": "eng.coder", "input": { "project": "storefront" } }
> ```

## UPDATE · `packages/harness-manager/README.md` · after "Running a mailbox's board"

A short "Running a conversation's tasks" section: the `ledgers` option in one example, the
output fields, and a link to the docs page section above.

## UPDATE · `packages/workforce/README.md` · the `workerTaskEntry` line

Name the `block` option beside `turn`, `conversationLedgers`, and the `projectWorkspace` order in one line.

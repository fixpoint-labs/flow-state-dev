# FIX-1668 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

No new page. The link is one field on the task record and one step in the hand-off, so it extends
the pages that already describe both. Voice notes for the writer: introduce "run" on first use as
the session a handed-off task executes in; no em-dash chains; don't open sentences with "This".

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · new `###` under "Seats that hand off", after "What the drain reports"

### Which run is working a task

When a handed-off task's run starts, it writes itself onto the task. The row gains a `run` field
naming the session the work is running in, the request, and the attempt:

```ts
// `collection` is the board's TaskCollectionRef
const task = collection.get("task_7f2");
if (task?.run) {
  // task.run.sessionId  — the session the worker is running in
  // task.run.requestId  — this attempt's request in that session
  // task.run.attempt    — equal to task.attempts
}
```

The run writes it, not the drain, because only the run knows for certain which session it landed
in. Under `per-worker` or a shared `key`, several tasks name the same session and each names its
own request. A board drained from two conversations still gives each row the run that took it.

To open the run, read the session first. A seat can hand its tasks to another flow, so the run
doesn't always belong to the flow you read the board through. The session knows its owner:

```ts
const session = await client.getSession(task.run.sessionId);
const flowKind = session.flowId; // the run's flow, never the board's
```

Every session a run is dispatched into records its flow, so there is nothing to fall back to.
Don't substitute the board's flow. Pass that `flowKind` to `useSession` and to the request reads. Through any other flow, a live
run's stream returns 404.

The `run_linked` change is published on the run's own session, like everything else the run writes
to the task. A view following a different session, such as the conversation that drained the
board, sees `run` the next time it reads the board.

The field is written just before the worker's first step. If the write is refused, because the
claim moved on in the meantime, the run stops with `StaleTaskClaimError` as it would for any stale
claim. If the store fails, the run stops before the worker starts and the board hands the row out
again later. If the run fails after `run` was written but before the worker starts, `run` stays:
it names a run whose request failed, which is where you'd look to see why.

`run` lasts until the task is next claimed. A completed, failed or cancelled task keeps the run
that last worked it, so you can open that session and see what happened. The claim that starts the
next attempt clears it, so between a hand-off and the new run's start the task has no `run`.

Read it as "which run", not "is it running". Whether work is live is the task's `status` and the
run's request. Rows stored before this field existed have no `run`; treat that the same as a task
whose run hasn't started. Tasks whose worker runs inline, in the drain itself, never get one.

Nothing a caller or a model sets can write `run`. Naming a session doesn't grant access to it:
opening the session or aborting the request still goes through the server's owner check.

## UPDATE · `apps/docs/docs/orchestration/task-substrate.md` · "task-change items"

In the kind list inside the code block, add `run_linked` after `assignee_changed`. Replace the
closing paragraph with:

> The `task` snapshot is the post-mutation row minus the fields the substrate keeps server-side.
> `claimedBy` is one of those, so it is absent from the item even while a task is claimed. `run`,
> the handed-off run working the task, is not: a UI can open that run from it. A `run_linked`
> item is published on the run's own session when the run records itself on its task. A view
> following another session sees `run` on its next read of the board; see
> [Which run is working a task](./task-board.md#which-run-is-working-a-task).

## UPDATE · `packages/orchestration/README.md` · after "Server-only task fields"

> **The run link.** A handed-off task carries `run: { sessionId, requestId, attempt }`, written by
> the board's claim gate inside the run's own session, before the worker starts, through a
> claim-fenced write that emits `task-change` of kind `run_linked` on the run's own session. The
> run's flow is its session's `flowId`, which may not be the board's. The next claim clears it; a
> settled task keeps it. It is client-visible, unlike `claimedBy`, and no write surface a caller
> reaches can set it. If you implement `TaskCollectionRef` yourself, implement the link verb too:
> a board that hands off calls it on every attempt.

## UPDATE · `packages/workforce/README.md` · the `readBoard` paragraph and the browser-read list

Replace "without the execution coordinates (`claimedBy`, the lease) or the substrate's write
provenance" with:

> without the claim's execution coordinates (`claimedBy`, the lease) or the substrate's write
> provenance. The one coordinate it does carry is `run`, the handed-off run working the task, so a
> reader can open that run.

In the browser-read list, add `run` after `assignee`.

## Not changed

`docs/architecture/dispatched-work.md` says a handed-off row's `claimedBy` holds the parent's
session. That stays true. Add one sentence after it, for maintainers:

> The run's own coordinate is `run`, which the claim gate writes from inside the run.

## Publication ownership

FIX-1668 publishes all of the above in its implementation PR. FIX-1664 owns shift-manager's README task
sentences and reads this page's section for the field's meaning; it doesn't restate it.

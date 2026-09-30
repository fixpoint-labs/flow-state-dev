# FIX-960 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Only changed material. Every board-layer example (`taskBoard({ collection: { backing: … } })`)
stays as it is (D2). No new page, no sidebar change.

**Two layers, two vocabularies (D2).** After this change a board is still configured with
`taskBoard({ collection: { backing: "sequencer" | "request" } })`, while the collection factory
under it takes `getOrCreateTaskCollection({ backing: "state" | "resource" })`. Wherever a page
shows both, it says so in one sentence: the board's words choose where the board's drain keeps
its work; the factory's words choose which state holds the tasks. Readers should not discover the
difference by diffing examples.

## UPDATE · `apps/docs/docs/orchestration/task-board.md` · "How long the counts last"

Replace the two backing bullets and the two paragraphs after the list with:

> - **On the request** (the default) — the tasks live on the request, so a new request starts
>   empty and all three counts start from zero.
> - **On a state you pass** — the counts last as long as that state does. A sequencer's state
>   is restored from its checkpoint on resume, task map included, so work after a resume is
>   checked against the tasks already there. A generator's own state is not checkpointed, so a
>   delegation board's tasks and counts start from zero after a resume. See
>   [Block State → The durability boundary](../advanced/block-state#the-durability-boundary).

In the same file, rewrite the code samples that call `getOrCreateTaskCollection` directly:
`backing: "request"` becomes `backing: "state"` (no `state` field), and the capped example becomes:

```ts
const tasks = await getOrCreateTaskCollection({
  ctx,
  backing: "state",
  state: ctx.sequencer!,
  collectionId: "my-board",
  maxTotalTasks: 2000,
});
```

Replace "the sequencer opt-in" in "Where the bounds apply" only where it means the collection
factory, and replace the final paragraph of that section with:

> The cap options exist on `backing: "state"` only. Passing `maxTotalTasks` or
> `maxEnqueuedTasks` with `backing: "resource"` is a TypeScript error, not a ceiling that
> quietly does nothing.

## UPDATE · `apps/docs/docs/skills/delegation.md` · "Board and overrides" example

```ts
const bounded = (ctx) =>
  getOrCreateTaskCollection({
    ctx,
    backing: "state",
    // The HOST generator's own state. Each tool runs as a child block, so the
    // generator's state is `ctx.parent`; the tool's own `ctx.self` is per-call.
    state: ctx.parent,
    stateKey: DELEGATION_BOARD_FIELD,
    collectionId: DELEGATION_BOARD_FIELD,
    maxEnqueuedTasks: 25,
  });
```

## UPDATE · `apps/docs/docs/orchestration/task-substrate.md`, `apps/docs/guides/board-lifecycle.md`, `apps/docs/guides/create-your-own-pattern.md`

In each direct `getOrCreateTaskCollection` call, `backing: "request"` becomes `backing: "state"`.
The board-lifecycle guide's backing table describes the board layer and is unchanged.

## UPDATE · `packages/orchestration/README.md` · "TaskCollection"

> `getOrCreateTaskCollection` resolves a `TaskCollectionRef` over one of two backings.
> `backing: "state"` keeps tasks in atomic state: on the request when you pass no `state`
> (the `taskBoard` default; survives block boundaries within a request), or on a state ref you
> pass, such as `ctx.sequencer` for one board invocation. `backing: "resource"` outlives the
> request: a user's queue, an org work pool, declared with `defineTaskCollection`. Every
> mutation that changes a field emits a `task-change` component item.

The example below it: `backing: "request"` becomes `backing: "state"`.

## UPDATE · `packages/patterns/README.md`

The `getOrCreateTaskCollection` example: `backing: "request"` becomes `backing: "state"`. The
board-layer sentence about `{ backing: "sequencer", collectionId }` is unchanged.

## CREATE · `.changeset/<name>.md`

```md
---
"@flow-state-dev/orchestration": minor
---

`getOrCreateTaskCollection` now has two backings, `state` and `resource`. The `sequencer` and
`request` backings are one: write `backing: "state", state: ref` where you wrote
`backing: "sequencer", sequencer: ref`, and `backing: "state"` with no `state` where you wrote
`backing: "request"`. Default slots are unchanged (`tasks` on a passed ref, the `collectionId` on
the request), so stored tasks stay where they are. Renamed exports:
`createSequencerBackedTaskCollection` → `createStateBackedTaskCollection`,
`SequencerBackedOptions` (field `sequencer` → `state`) → `StateBackedOptions`, and
`SequencerBackingSpec` / `RequestBackingSpec` → `StateBackingSpec`. `taskBoard` options are
unchanged.
```

## Publication ownership

FIX-960 publishes all of the above in its implementation PR after V1. Voice: no issue numbers in
`apps/docs`, minimal em-dashes, and "state" introduced as "the atomic state the tasks live in" on
first use in each page.

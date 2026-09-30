# FIX-960 · Rename the task-collection `sequencer` backing to `state` and fold the two StateRef arms into one

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · `orchestration` + `patterns` · small (7 surfaces, 6 checks, 7 doc files) · 1 PR · no epic (found in [FIX-957](https://linear.app/fixpoint-labs/issue/FIX-957)'s review)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **reads the delegation board's own-state wiring** | Sees `backing: "sequencer"` over a *generator's* own state. The word promises checkpointing it doesn't have, and it misled a spec author last week ([FIX-958](https://linear.app/fixpoint-labs/issue/FIX-958)) | Sees `backing: "state", state: ctx.parent`. The config names the state it holds and nothing more |
| **keeps a pattern's tasks on the request** | Writes `{ backing: "request", collectionId }` | Writes `{ backing: "state", collectionId }`. Leaving out `state` means the request, in the same slot as today ([D1](DECISIONS.md#d1)) |
| **puts caps on a board they build by hand** | Caps are allowed on two of three backings, and a comment paragraph explains why | Caps go on the one state-backed arm. Asking for one on `resource` is still a type error |
| **upgrades and still imports the old names or writes the old literal** | Compiles | A type error at the old name, and a runtime error naming the new spelling for untyped callers. The changeset says what to type. Nothing stored needs migrating |
| **already has tasks in a request or a checkpointed sequencer** | Tasks sit at `collectionId` on the request, or `tasks` on the passed state | Read from the same slot. Nothing moves |
| **configures `taskBoard({ collection: { backing: "sequencer" } })`** | Works | Unchanged. The board's own word stays, because there it is true ([D2](DECISIONS.md#d2)) |

Two of the three arms already share one code path: request-backed collections go through the
same constructor as sequencer-backed ones via an adapter. They differ only in which state is
handed in and which slot is the default. `resource` is a different storage mechanism and stays.

## The goal, and how we'll know it's met

**Someone reading a task-collection config can tell from the config alone which state holds the
tasks, and every existing board keeps its tasks exactly where they are today.**

| Is it the right goal? | |
|---|---|
| **The real need** | "The discriminant already lies at one of its own call sites" and "a hard rename, not a reshape: same routing, same defaults, same runtime behavior" ([the issue](https://linear.app/fixpoint-labs/issue/FIX-960)) |
| **Smaller, and rejected** | "The new names compile." Hittable while one arm quietly changes its default slot, which moves stored tasks out from under a running app |
| **Bigger, and not this issue's** | Enforcing caps across every backing, [FIX-957](https://linear.app/fixpoint-labs/issue/FIX-957). Renaming the board-layer vocabulary ([D2](DECISIONS.md#d2)) |
| **Not done if** | The suite is green but no test pins the request default slot · the old literal still type-checks through a loose cast · a doc page still teaches `backing: "sequencer"` for a collection |

**No goal check applies:** this is a behaviour-preserving rename, so no run on a real model can
tell before from after, and that is the claim. What proves it instead: `pnpm typecheck` and
`pnpm test` green on `main` and on the branch across every dependent package, the census
([`poc/call-site-census/`](poc/call-site-census/census.mjs)) reporting zero old-spelling
collection sites after, and a new default-slot test. **Control that must fail:** the type-test
that writes the old literal under `@ts-expect-error` fails typecheck if the old spelling is still
accepted, and the default-slot test fails if either default is swapped (PLAN V2, V3).

## What changes

![Two rows. Today three backing arms, sequencer and request both reaching one state-backed constructor through an adapter, resource separate, caps on two arms. After, two arms: state, with an optional state ref that defaults to the request, reaching the same constructor with caps, and resource unchanged.](figures/what-changes.svg)

Read the middle column. The constructor and its two defaults were already one mechanism; after,
the options say so. The request adapter survives as an internal detail of the omitted-`state` case.

**What a pattern author types:**

```diff
  const tasks = await getOrCreateTaskCollection({
    ctx,
-   backing: "sequencer",
-   sequencer: ctx.sequencer!,
+   backing: "state",
+   state: ctx.sequencer!,
    collectionId: "my-plan",
  });

  const queue = await getOrCreateTaskCollection({
    ctx,
-   backing: "request",
+   backing: "state",          // no `state`: tasks live on the request, slot = collectionId
    collectionId: "research",
  });
```

**The exported names** (`@flow-state-dev/orchestration`, `/tasks`):

```diff
- createSequencerBackedTaskCollection   SequencerBackedOptions { sequencer }
+ createStateBackedTaskCollection       StateBackedOptions     { state }
- SequencerBackingSpec | RequestBackingSpec
+ StateBackingSpec
```

## What stays as it is

- **`resource` backing**, and the FIX-957 cap-enforcement work.
- **Every default slot:** `tasks` when a state ref is passed, the `collectionId` when it isn't.
  These are where stored tasks live, so they are the part that must not move (BR-1, BR-2).
- **The task-board layer:** `taskBoard({ collection })` specs, `TaskBoardBacking`, `board.backing`
  and the messages that print it. Its calls into the collection factory change spelling only.
- **Everything emitted:** `task-change` items, their keys, claim identity.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** the config names the state it
holds, and no stored task moves. If wrong: we ship a rename that relocates someone's tasks, or
hold a naming fix open for cap work it was never meant to carry.

1. **[D1](DECISIONS.md#d1) · A request-backed collection is written by leaving `state` out,
   rather than passing `ctx.request`.** If wrong: one default a reader has to learn. Switching to
   an explicit `ctx.request` later is additive and cheap.
   The smaller alternative is rename-only: keep an explicit `backing: "request"` arm and no
   implicit default, at the cost of caps still sitting on two of three arms
   ([priced in D1](DECISIONS.md#d1)).
2. **[D2](DECISIONS.md#d2) · The task-board layer keeps `"sequencer"` and `"request"`; only the
   collection factory is renamed.** If wrong: two words for neighbouring layers until a follow-up
   renames the board's, which is its own breaking change.

**Open: none.** Number 1 is the one to weigh. Reasoning and what lost:
[DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).

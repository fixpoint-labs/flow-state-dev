---
sidebar_position: 5
sidebar_label: Reactive blocks
---

# Reactive blocks

A reactive block runs automatically when a resource changes. It's a regular block, a handler, a generator, or a sequencer, that you bind to a resource or collection mutation. When something creates, updates, or deletes that resource — or writes its content body — the block runs inside the same session that caused the change, as part of the same turn.

Because it runs inside the originating turn, a reactive block gets the full execution context: `ctx.resources` and scope handles, the live item stream, and trace and DevTool visibility. Items it emits land in that turn's stream, ordered with everything else the turn produced.

## When to reach for this

Collections already have lightweight lifecycle callbacks, `onInstanceCreated`, `onInstanceUpdated`, and `onInstanceDeleted` (see [Resource Collections](/docs/resources/collections#lifecycle-hooks)). Those are synchronous, fire-and-forget functions. They're the right tool when all you need is to log a change or mirror it into another store.

Reach for a reactive block when the reaction needs to do real work in the flow:

- Emit items into the stream (a status message, a generated artifact, a tool call result).
- Run sub-blocks, call models, or use tools.
- Show up in traces and the DevTool as part of the turn.

The two coexist. A collection can keep its `onInstance*` callbacks for cheap logging and use `reactTo` for the block-driven reaction. For the block case, `reactTo` is the upgrade path: it supersedes the callback when you need anything the callback can't do. Single resources never had lifecycle callbacks; `reactTo` is how they get reactions at all.

## Declaring `reactTo`

`reactTo` is a field on `defineResource()` and `defineResourceCollection()`. You map each reactive kind you care about to a block. Three of them are state changes — `created`, `stateUpdated`, `deleted` — and one is a content-body write, `contentUpdated` (see [Reacting to content changes](#reacting-to-content-changes)):

```ts
import { defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";

const memoSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "published"]).default("draft"),
});

const announceMemo = handler({
  name: "announce-memo",
  execute: async (change, ctx) => {
    ctx.emitMessage(`New memo: ${change.state.title}`);
  },
});

const memos = defineResourceCollection({
  pattern: "memos/**",
  stateSchema: memoSchema,
  reactTo: {
    created: announceMemo,
  },
});
```

Each entry is either a bare block, as above, or an object `{ block, when }` where `when` gates dispatch (covered below).

Collections fire all four kinds. Single resources support only `stateUpdated` and `contentUpdated`: a single resource always exists with a default state and has no create or delete lifecycle, so `defineResource` accepts those two and throws on `created` or `deleted`.

State and content are separate axes. A `patchState` runs a `stateUpdated` reaction; a `writeContent` runs a `contentUpdated` reaction, not `stateUpdated`. To react to either kind of change, bind the same block to both.

## What the block receives

A reactive block is called with a `ResourceChange` payload as its input:

| Field | Type | Meaning |
| --- | --- | --- |
| `key` | `string` | The collection instance key, or the single resource's ref name. |
| `ref` | `string` | The full storage path, e.g. `"memos/launch"`. |
| `kind` | `"created" \| "stateUpdated" \| "deleted"` | Which state mutation fired. |
| `state` | state object or `null` | Post-mutation state. `null` on `deleted`. |
| `prevState` | state object or `null` | Pre-mutation state. `null` on `created`. |
| `evicted` | `boolean` | `true` only when a delete came from a capacity eviction (LRU or oldest), not an explicit `delete()`. |

To type the input against your resource's state, use `resourceChangeSchema`, which wraps your state schema in the `ResourceChange` shape:

```ts
import { resourceChangeSchema, handler } from "@flow-state-dev/core";

const announceMemo = handler({
  name: "announce-memo",
  inputSchema: resourceChangeSchema(memoSchema),
  execute: async (change, ctx) => {
    // change.state is typed as the memo state (nullable)
    ctx.emitMessage(`New memo: ${change.state?.title}`);
  },
});
```

Both `resourceChangeSchema` and the `ResourceChange` type come from `@flow-state-dev/core`.

## Reacting to content changes

A resource has two axes: structured `state` (via `patchState`) and a content body (via `writeContent`). The kinds above react to state. To react to a content write, bind `reactTo.contentUpdated`. It runs after the body is persisted, so a `readContent()` inside the block returns the new body. This is the natural home for work derived from the body — re-summarizing a document, re-indexing it, post-processing a written file.

```ts
import { defineResourceCollection, resourceContentChangeSchema, sequencer, handler, utility } from "@flow-state-dev/core";
import { z } from "zod";

// Reads the fresh body and stores a summary back on the artifact's state.
const summarize = sequencer({ name: "summarize", inputSchema: resourceContentChangeSchema() })
  .step(handler({
    name: "read-body",
    inputSchema: resourceContentChangeSchema(),
    outputSchema: z.object({ key: z.string(), content: z.string() }),
    execute: async (change, ctx) => {
      const ref = await ctx.resources.artifacts.getOptional(change.key);
      return { key: change.key, content: (await ref?.readContent()) ?? "" };
    },
  }))
  .step((loaded) => loaded.content, utility.summarizer({ name: "summarizer", model: "openai/gpt-5.4-mini" }))
  .step(saveSummary); // patchState({ summary }) — a state write, so it won't re-trigger this reaction

const artifacts = defineResourceCollection({
  pattern: "artifacts/**",
  stateSchema: artifactSchema,
  reactTo: { contentUpdated: summarize },
});
```

A content reaction receives a minimal `ResourceContentChange` payload — bodies are never inlined:

| Field | Type | Meaning |
| --- | --- | --- |
| `key` | `string` | The collection instance key, or the single resource's ref name. |
| `ref` | `string` | The full storage path, e.g. `"artifacts/memo-1"`. |
| `kind` | `"contentUpdated"` | Always `"contentUpdated"`. |

Type the input with `resourceContentChangeSchema()` (no state schema — a content change carries only identity). Read the body with `readContent()` and read state from `ctx.resources` if you need it. Everything else — [timing](#timing), [the cascade guard](#cascades-and-the-depth-guard), [`when`](#conditioning-with-when), and [trace nesting](#in-the-trace) — works exactly as it does for state reactions.

Because a content reaction often writes state back (the summary above), note the loop boundary: `patchState` fires `stateUpdated`, not `contentUpdated`, so saving derived state does not re-trigger the content reaction.

`contentUpdated` fires for server-side content writes — a tool that calls `writeContent`, the generic content tool, a file flush. Content edits driven straight from a client (`client.content.update`) run outside any flow turn and do not fire a reaction yet.

## Timing

A reactive block runs blocking, by default, as part of the turn that triggered it. The mutation, the reaction, and any items the reaction emits all belong to one turn, in order. There is no `mode` field to change this.

Failure is atomic, as a result: if a reactive block throws, the mutating turn fails. That's usually what you want for a reaction that's part of the operation's correctness. When the reaction is a side effect you don't want to block on, or could fail independently, make the reactive block a sequencer that uses `.work()`. Work runs in the background, isolated from the turn's success, and drains before the turn reaches a terminal status:

```ts
import { sequencer } from "@flow-state-dev/core";

const indexMemo = sequencer({ name: "index-memo" })
  .work(pushToSearchIndex); // background, isolated; a throw here won't fail the turn
```

So the choice is direct: a blocking block when the reaction must succeed for the turn to be correct, a `.work()` sequencer when it's a fan-out side effect that should run on its own.

## Conditioning with `when`

Wrap a binding as `{ block, when }` to gate dispatch. `when` receives the same `ResourceChange` and returns a boolean. Return `false` and the block doesn't run.

Fire only on a real transition, here only when a memo reaches `published`:

```ts
reactTo: {
  stateUpdated: {
    block: announceMemo,
    when: (change) => change.state?.status === "published",
  },
},
```

Skip evictions, so a `deleted` reaction runs for explicit deletes but not for capacity-driven removals:

```ts
reactTo: {
  deleted: {
    block: cleanupMemo,
    when: (change) => !change.evicted,
  },
},
```

## Cascades and the depth guard

A reactive block can mutate a resource that has its own reactive block, which fires another reaction, and so on. That re-triggering is allowed, but the framework caps how far it can go in a single turn: it bounds both the re-entrancy depth and the total fan-out. On a breach it stops and emits a `reactive_cascade_exceeded` diagnostic as a failed `error` item, rather than recursing forever or hanging the turn.

You don't configure these limits. They're a backstop against accidental loops, not a tuning knob. If you hit the diagnostic, it means a reaction chain is feeding back on itself, and the fix is in the flow's logic, usually a `when` gate that stops the chain re-firing on its own writes.

## In the trace

A reactive block shows up in the trace nested under the block that performed the mutation, not at the request root, so you can see what triggered it. Its trace path is self-describing: `__reactive__/<resource-ref>/<kind>`, for example `__reactive__/memos/memo-1/stateUpdated` or `__reactive__/artifacts/memo-1/contentUpdated`. If the reaction itself mutates a resource and triggers a further reaction, that one nests under the reaction, so a cascade reads as a tree.

## See also

- [Resource Collections](/docs/resources/collections) — patterns, eviction, and the `onInstance*` lifecycle callbacks
- [Resources Overview](/docs/resources/overview) — `defineResource`, content, and state
- [Blocks](/docs/fundamentals/blocks) — handlers, generators, and sequencers
- [Items](/docs/streaming/items) — what a reactive block emits into the stream

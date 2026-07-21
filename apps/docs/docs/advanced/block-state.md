---
sidebar_position: 10
sidebar_label: Block state
---

# Block State

Any block — a handler, generator, router, or sequencer — can hold its own request-scoped state. Declare it the same way a sequencer already does: add `stateSchema` to the block's config.

```ts
const tracker = handler({
  name: "tracker",
  stateSchema: z.object({ note: z.string().nullable().default(null) }),
  execute: async (input, ctx) => {
    await ctx.self!.setState({ note: `saw ${input}` });
    return ctx.self!.state.note;
  },
});
```

`ctx.self` reads and writes the block's own container. It's namespaced by the block itself, so a field can be named `activeSkills` or `note` without worrying about colliding with state on some other block in the flow. If the block declares no `stateSchema`, `ctx.self` is `undefined` — guard with `?.` or assert with `!` once you know the block always has one.

This state lives for one execution of the block, within the current request. It's the same underlying mechanism [Sequencer State](/docs/advanced/sequencer-state) already uses — a sequencer's `stateSchema` is just the common case of block state, where the block happens to be a sequencer.

## Four ways to address block state

Block state is one primitive with four addressing modes, depending on which block you want to reach:

| Handle | Points to |
|---|---|
| `ctx.self` | This block's own state |
| `ctx.parent` | The immediate parent's state |
| `ctx.sequencer` | The nearest enclosing sequencer's state |
| `ctx.targets.<name>` | A specific named ancestor's state |

`ctx.sequencer` and `ctx.targets` aren't new — see [Sequencer State](/docs/advanced/sequencer-state) and [State Targets and Parents](/docs/advanced/state-targets-and-parents) for those. This page covers the two new handles, `ctx.self` and `ctx.parent`, and how all four relate.

## Reading a parent's state: `ctx.parent`

A child block reaches its immediate parent's state via `ctx.parent`, without naming it. Declare the shape you expect with `parentStateSchema`.

The catch: only a sequencer, router, or generator can dispatch a *child* block — a plain handler is always a leaf, so two handlers chained with `.step().step()` on the same sequencer are siblings, not parent and child (both report to the sequencer as their `ctx.parent`). To see a genuine owner/child pair, the owner has to be the thing doing the dispatching:

```ts
const child = handler({
  name: "child",
  parentStateSchema: z.object({ note: z.string().nullable() }),
  execute: async (_input, ctx) => `parent said: ${ctx.parent?.state?.note}`,
});

const pipeline = sequencer({
  name: "owner-then-child",
  stateSchema: z.object({ note: z.string().nullable().default(null) }),
})
  .tap(async (input, ctx) => {
    await ctx.self!.setState({ note: summarize(input) });
  })
  .step(child);
```

`pipeline` is the owner here: its `.tap()` step runs directly in the sequencer's own scope, so `ctx.self` there is the sequencer's own state. `child`, dispatched one level inside it via `.step()`, reads that same container as `ctx.parent`. Same container, two sides — whoever is asking determines which handle you reach for.

`ctx.parent` is `undefined` when there's no parent (the block is at the root), and its state ops are absent — not present-and-throwing — when the parent declared no `stateSchema`. Guard with `?.` either way.

This is the shape a generator's tool loop uses: the generator declares `stateSchema` and reads `ctx.self`; a tool it calls is a child block and writes back via `ctx.parent`, without either side naming the other.

```ts
const activateSkill = handler({
  name: "activate-skill",
  inputSchema: z.object({ id: z.string() }),
  parentStateSchema: z.object({ activeSkills: z.array(z.string()) }),
  execute: async (input, ctx) => {
    await ctx.parent?.pushState?.("activeSkills", input.id);
    return { ok: true };
  },
});

const researcher = generator({
  name: "researcher",
  stateSchema: z.object({ activeSkills: z.array(z.string()).default([]) }),
  tools: [activateSkill],
  context: (_input, ctx) =>
    `Active skills: ${(ctx.self?.state.activeSkills ?? []).join(", ")}`,
  prompt: "...",
});
```

Each tool call is its own scope, so `activateSkill`'s *own* `ctx.self` resets every time it's called — the useful handle for a tool is `ctx.parent`, reaching back to the generator that owns it.

## Routers stay read-only

A router can declare `stateSchema` and read `ctx.self` in its `execute`, but shouldn't write to it there. A durable router's selector can re-run on resume, and re-running a write would either duplicate it or diverge from what was already recorded. If a router needs to record something, put a `.tap(handler)` in front of it and let that handler do the write — the router still reads it via `ctx.self`.

## The fan-out and loop contract

State isolation follows the same rule everywhere blocks branch or repeat: **a fresh iteration gets a fresh container; the block that owns the loop keeps accumulating in its own.**

```ts
const item = handler({
  name: "item",
  stateSchema: z.object({ seen: z.number().default(0) }),
  execute: async (value, ctx) => {
    await ctx.self!.incState({ seen: 1 });
    // `seen` is always 1 here — every iteration starts from scratch.
    return ctx.self!.state.seen;
  },
});

const pipeline = sequencer({ name: "process-all" }).forEach(item);
```

- **`forEach` / `parallel`** — each iteration or branch is a distinct scope, so its `ctx.self` never leaks to a sibling.
- **`loopBack`** — the sequencer that owns the loop keeps one container across every pass, so its own `ctx.self` (or `ctx.sequencer`, from a step inside it) accumulates. A re-executed step's *own* `ctx.self` still resets each pass — only the loop owner's state persists across iterations.

If a loop body needs to remember something across its own passes, it writes that onto the loop owner via `ctx.parent` or `ctx.sequencer`, not its own `ctx.self`.

## The durability boundary

Block state lives in memory for the duration of the request, the same FIFO-locked container sequencer state already uses. It streams live as `state_change` items, but — unlike session, user, and org state — it's transient by default in production, so it isn't something a client can read back after the fact.

A non-sequencer block that suspends mid-execution loses its in-memory state on resume today. If your block needs to survive a suspend/resume cycle, keep that state on the enclosing durable sequencer for now, where checkpointing already works.

## Capabilities can contribute `ctx.self`

A capability can declare `stateSchema` too, and give the blocks it's used on a working `ctx.self` without them declaring `stateSchema` directly — useful when a capability (a skills registry, say) needs somewhere to keep its own state on the generator it's attached to:

```ts
const skillsCapability = defineCapability({
  name: "skills",
  stateSchema: z.object({ activeSkills: z.array(z.string()).default([]) }),
});

const researcher = generator({
  name: "researcher",
  uses: [skillsCapability],
  // No `stateSchema` here — the capability supplied it. ctx.self still works.
  context: (_input, ctx) => `active skills: ${ctx.self?.state.activeSkills.join(", ")}`,
  // ...
});
```

If two sources declare the same field — two capabilities, or a capability and the block's own `stateSchema` — the fields must be structurally compatible, or the build throws. See [Authoring capabilities](/docs/advanced/capabilities-authoring) for the merge rules.

## Where to next

- **[Sequencer State](/docs/advanced/sequencer-state)** — `ctx.sequencer` is the nearest-sequencer addressing mode over this same primitive.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — `ctx.targets.<name>` reaches a specific named ancestor instead of the immediate parent.
- **[State Operations](/docs/fundamentals/state-operations)** — the operation reference (`setState`, `patchState`, `incState`, ...) shared by every state handle.
- **[Authoring capabilities](/docs/advanced/capabilities-authoring)** — how a capability contributes `stateSchema` (and other config) to the blocks that use it.

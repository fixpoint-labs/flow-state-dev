# Action Forms — one dispatch protocol

Every arrival at a flow is a **dispatch** of one **type**, delivered to one
**entry** addressed by `(type, name)`. A caller over HTTP sends a `public`
dispatch to `flow.actions[name]`. The host cron sends a `schedule` dispatch to
`flow.schedules.static[id]`. A task board drain sends a `task` dispatch to
`flow.tasks[name]`. A running request sends an `internal` dispatch to
`flow.internal[name]`. Delivery is the same for all of them — one envelope,
one door (`host.dispatch`), one request record — and so is addressing: one
keyed lookup with **no fallback**.

This doc is the canonical reference for that model: the entry, the six
types, the address, the block that sends, and what must not silently change.

## The entry: `ActionCore`

`ActionCore` (`packages/core/src/types/flow.ts`) is the shape every entry
builds on:

```ts
type ActionCore<TBlock extends BlockDefinition = BlockDefinition> = {
  block: TBlock;                 // the executable unit
  inputSchema?: TBlock["inputSchema"];
  onCompleted?: BlockDefinition;
  onErrored?: BlockDefinition;
  userMessage?: (input) => string;
  tokenBudget?: { maxTotalTokens: number; warnAt?: number; onExceeded?: ... };
  durable?: boolean;
  concurrency?: ConcurrencyConfig;   // per-entry; every type gets the same ladder
};
```

The core is independent of how the entry is addressed or authenticated. That
is what lets a webhook handler, a task worker's gate, or an internal wake be a
first-class entry without living in `flow.actions`.

## The six dispatch types

| Type       | Arrives from                                        | Map on the flow                          | Input schema owned by |
| ---------- | --------------------------------------------------- | ---------------------------------------- | --------------------- |
| `public`   | a caller — HTTP, MCP, voice, any custom transport   | `flow.actions[name]`                     | the author            |
| `chat`     | the chat adapter, on a matched subscription         | `flow.chat.on[eventKey]`                 | the chat protocol     |
| `webhook`  | a verified external sender                          | `flow.webhooks[provider].on[eventType]`  | the sender            |
| `schedule` | the host cron                                       | `flow.schedules.static[scheduleId]`      | the framework         |
| `task`     | a task board drain handing a claimed row off        | `flow.tasks[name]`                       | the framework         |
| `internal` | a `dispatcher()` block in one of this flow's requests | `flow.internal[name]`                  | the author            |

A dispatch's type is decided by **which door it came through** — the trusted
`source` an adapter or the dispatch seam stamps on the envelope
(`dispatchTypeOf` in `engine/execution/transport-sources.ts`): `webhook`,
`chat`, `scheduled`, `task`, `internal`, and every other source is `public`.
Nothing in a request body can pick a type, which is what makes each map a
boundary a caller cannot cross.

```ts
const conductor = defineFlow({
  kind: "conductor",
  actions:  { seed, status, answer },        // public — the caller-facing API
  internal: { wake: { block: wakeBlock } },  // reachable only from a dispatcher inside
  tasks:    board.tasks,                     // produced by the board; the claim gate per seat
  schedules: { static: { nightly: { cron: "0 3 * * *", block: sweep } } },
});
```

`internal` and `tasks` are definition-only, like the transport maps: an
instance option naming them is refused.

## The address: one lookup, no fallback

`resolveEntry(flow, type, name, coordinate?)` (`packages/core/src/flow/resolve-entry.ts`)
reads exactly one map and returns the entry or `undefined`. The engine's
`resolveEntry(flow, actionName, source, metadata)`
(`engine/execution/resolve-entry.ts`) maps the source to the type and reads
the protocol coordinate for `chat` / `webhook` / `schedule` out of the
adapter's namespaced metadata slot. Every branch is terminal:

- A `task` dispatch named `implement` resolves `flow.tasks.implement` or
  nothing. It never reaches `flow.actions.implement`, however that action is
  named.
- A `webhook` dispatch with no coordinate resolves nothing — it does not fall
  back to an action named after the handler block.
- A forged `metadata.chat.eventKey` on an `http` dispatch is ignored: the
  source says `public`, so the caller's named action resolves and nothing else.

The cost is deliberate: a handler reachable from two types is declared twice,
under both maps, with one block. A block shared that way cannot assume which
type it runs under, so anything type-specific — a task's claim, a schedule's
handle — reaches the entry as **input**, never as an ambient `ctx` member.

### The source gate, restated

The old model had five maps keyed on `source` and one fallback. The fallback
was the hole: a framework-stamped dispatch whose provenance name collided with
a public action's key would have been handed the public handler. The
detached source was made terminal to close it — and the exception was the
rule. With no fallback for any type, the property the detached branch carried
alone now holds for all six: a dispatch cannot reach a handler outside its own
type's map.

## Sending: `dispatcher()`, a block, not a `ctx` method

A **router** picks a block to run *here*. A **dispatcher** names an entry to
run *elsewhere* — in a child session it derives, or in a session that already
exists. It is a handler under the hood, and it carries its `(type, target)`
on the block definition so `defineFlow` can verify the target resolves.

```ts
const wakeEpic = dispatcher({
  name: "wake-epic",
  type: "internal",
  target: "wake",                                    // flow.internal.wake
  inputSchema: z.object({ epicSessionId: z.string(), reason: z.string() }),
  session: { id: (input) => input.epicSessionId },   // deliver into an existing session
  payload: (input) => ({ reason: input.reason }),
});

const analyzeInBackground = dispatcher({
  name: "analyze-in-background",
  type: "internal",
  target: "analyze",
  inputSchema: z.object({ documentId: z.string() }),
  session: { key: (input) => input.documentId },     // one child per document, adopted on retry
});
```

**The address is static so it can be verified; the envelope is dynamic so it
can be useful.** `type` and `target` never vary — that pair is what
`defineFlow`'s walk checks. The session and payload are computed per
invocation. When the address genuinely varies, that is a `router` over
declared dispatchers: the reachable set stays declared, and a model choosing a
recipient chooses from an allowlist rather than producing a run-time string.

A dispatcher returns `{ sessionId, requestId, adopted }`. A refusal throws
`DispatchRefusedError` with the refusal by name (`no-entry`,
`session-not-found`, `session-not-addressable`, `key-occupied`,
`no-dispatch-operation`, `dispatch-rejected`), so a `.rescue()` can branch on
it. Every refusal is decided before anything is dispatched.

### The two session targets

| `session`   | The dispatch runs in                                                 | Not found                     |
| ----------- | ------------------------------------------------------------------- | ----------------------------- |
| `{ key }`   | a **child** of the running session, derived from the key + tenant + principal + parent session + lineage | minted; the same key from the same parent is **adopted** next time |
| `{ id }`    | an **existing** session — same flow kind, same principal, same tenant, not bound to another org | **refused**, never created |

Reject on an unknown id is the recoverable branch: an unknown id is a typo, a
stale reference, or — once a send verb is in a model's hands — a hallucination,
and auto-creating turns all three into work nobody is watching. A named
channel session is still a legitimate shape; it is created through the
session-create route and then addressed by id.

### There is deliberately no `ctx.dispatchMessage`

The runtime attaches its dispatch operation to the block context under the
`DISPATCH_SEAM` **symbol**, not as a named member. `dispatcher()` reaches it
through `dispatchThroughSeam`; so does the task board's hand-off block, which
is marked with `markDispatcher` for the same reason. Nothing a handler body
names dispatches. That is what makes two things true at once:

- `defineFlow` walks the reachable block graph — composition, rescue handlers,
  a generator's static `tools` — and refuses an address that resolves nothing,
  naming the block and the address. The walk is complete because the seam is
  reachable only from blocks that carry an address. The one place a block is
  built at run time — a `.forEach()` given a per-item factory — declares what
  the factory can produce through its `blocks` option, which is how a task
  board's drain exposes the hand-offs inside its worker pool to the walk.
- A task board can read which of its seats hand off without running anything.

A dispatcher that was previously three verbs — start a detached job, spawn a
sibling, send a message — is one block with one optional session argument.

## Task hand-off: the board is the only thing that mints rows

A `task` dispatch is the one type that carries a claim on a durable row. Rows
are minted by a task board and by nothing else, so `flow.tasks` is meaningful
only as `tasks: board.tasks`: the board produces one entry per handed-off
seat, each wrapping the seat's worker in the board's **claim gate**, and
brands it. `defineFlow` refuses an unbranded task entry, and refuses a
hand-off whose entry belongs to a different board than the one that built it.

```ts
const board = taskBoard({
  boardId: "issue-work",
  collection: workBoardCollection,
  workers: {
    triage:    triageBlock,                                         // inline, in the drain
    implement: { worker: implementBlock, session: "per-task" },     // its own child per row
    review:    { worker: reviewBlock, session: { key: (t) => t.input.issue } }, // one child per issue
  },
});
```

The gate does four things off one durable read before the worker runs:
re-read the claimed row and verify the claim is still current (`attempt`,
`createdAt`, `incarnationId`, `status`, an unexpired lease, and that the row
still routes to this seat); mark the task scope; re-mint the claim ticket from
the verified row; start lease renewal from the child's own async chain. The
envelope a `task` dispatch carries is fixed and server-derived:

```ts
type TaskDispatchInput = {
  boardId: string;      // which board's ledger — the entry refuses any other
  taskId: string;
  attempt: number;      // verified, never trusted
  createdAt: number;
  incarnationId?: string;
  payload: unknown;     // the materialized worker input, packed at claim time
};
```

Uniform and floor workers run inline: a task entry is addressed by its seat
*name*, and a worker with no name has no address.

## Concurrency: default → per-entry, for every type

The arbiter resolves `entry.concurrency ?? flow.request.concurrency ?? "allow"`
through the same keyed lookup a dispatch resolves its handler with. A task
hand-off whose seat name collides with a public action never inherits that
action's `queue` / `reject`; a chat or schedule entry can declare its own
policy where before it could only take the flow default. A child session
shared across rows (`per-worker`, or a `key` policy) wants `queue` on its
entry rather than the `allow` default, or two dispatches interleave.

## What must not silently change

- **`task` and `internal` are in the never-re-enterable set**
  (`engine/routes/public-reentry.ts`), not merely absent from the allow-list.
  Retry, continue and resume refuse them, and a host's `publicReentrySources`
  cannot re-open them. Both are dispatched from inside a running request and
  have no caller-facing entry, so they may have no caller-facing re-entry. A
  spawned session *is* reachable from outside — by a `public` dispatch to its
  id, an ordinary caller-addressed request.
- **The source is trusted because a caller cannot set it.** Every
  authorization branch that reads it depends on that (BP-031).
- **The seam stays off `ctx`.** Adding a named dispatch verb to the block
  context would make the reachable set unknowable at definition time.

## The carried core: dynamic schedules

Five of the six coordinates point at something declared statically. A
**dynamic** schedule's `ScheduleConfig` is produced by the resolver at
dispatch time and has no static coordinate, so the adapter sets
`resolvedActionCore` on the envelope and `runAction` runs it directly. Before
it does, it walks the carried core's blocks for dispatch addresses and refuses
one the flow does not declare — the same check `defineFlow` makes, at the
one seam a dispatch-time core passes through.

The carried core is not serialized and not persisted, so a durable dynamic
schedule mid-run when the process crashes cannot re-resolve its handler and
is dropped. Make a schedule static if it must survive a crash.

| Form                    | Reachable on recovery via              | Crash-recoverable when durable |
| ----------------------- | -------------------------------------- | ------------------------------ |
| `public` entry            | `flow.actions[name]`                   | Yes                            |
| `chat` entry            | `flow.chat.on[eventKey]`               | Yes                            |
| `webhook` entry         | `flow.webhooks[provider].on[event]`    | Yes                            |
| Static `schedule` entry | `flow.schedules.static[id]`            | Yes                            |
| `task` entry            | `flow.tasks[name]`                     | Yes                            |
| `internal` entry        | `flow.internal[name]`                  | Yes                            |
| Dynamic schedule        | carried `resolvedActionCore` (transient) | **No**                       |

## Related

- [Detached Work](./detached-work.md) — what happens to a dispatched request
  over its lifetime, per deployment topology.
- [Inbound Transports](./inbound-transports.md) — the `InboundTransportAdapter`
  contract and the `InboundRequestEnvelope` every dispatch travels on.
- [State and Scopes](./state-and-scopes.md) → *Child sessions and scope* —
  what a child session inherits, and `sharedToLineage`.
- [Webhook Transport](./webhook-transport.md), [Chat Transport](./chat-transport.md),
  [Scheduled Actions](./scheduled-actions.md) — the three protocol-owned types.

# Design — `flow.tasks` replaces Workstreams

**Date:** 2026-08-29
**Status:** Proposal — not approved, nothing implemented.
**Type:** Framework change — `@flow-state-dev/core` (flow surface, detached source), `@flow-state-dev/engine` (request host, routes), `@flow-state-dev/orchestration` (task board), `@flow-state-dev/devtool`.
**Supersedes in effect:** the routing half of FIX-982 (P2 bindings, P3a core assembly) and FIX-999's `workstream` source naming. Keeps FIX-1068 (lineage) intact under a better name.

---

## The problem, plainly

We built a second way to run work, parallel to the one we already had.

A flow declares `actions`, and a caller names one. Detached work declares nothing —
it accumulates. A task board stamps a *binding* onto its drain sequencer, each
enclosing sequencer merges its children's bindings upward, `defineFlow` collects
the union off each action root, and a keyed router is assembled from that union
into a single `flow.workstream` entry. A detached dispatch resolves that one entry
and nothing else.

So we have two registries that answer the same question — *which block runs this
name?* — with different mechanisms, different failure modes, and different words.
`flow.actions` is a map somebody wrote. `flow.workstream` is a router nobody wrote,
derived from a graph walk, keyed by a length-framed composite of `boardId` and an
encoded worker coordinate.

That is a shadow flow system. It has its own routing table
(`workstreamBindings`), its own resolution rule (`WORKSTREAM_SOURCE`, terminal),
its own refusals (`no-workstream-core`, `board-not-routable`), its own session
kind (a "Workstream"), its own HTTP route, its own devtool tab, and its own word
for a resource that stores one level up (`sharedToWorkstream`). None of it is
wrong. All of it is a second copy of concepts the framework already has.

**This proposal deletes the second copy.** Detached work becomes a named entry in
`flow.tasks`, addressed by two ordinary strings. A spawned session becomes an
ordinary child session. The word "Workstream" stops having a referent and goes
away.

### The symptom that makes it concrete

`startDetached` is on every block's execution context and documented as "a general
verb." In the whole repo there is **one caller**
(`packages/orchestration/src/task-board/blocks/spawn-detached.ts`) and **one
producer of bindings** (`packages/orchestration/src/task-board/index.ts:1202`). A
flow with no task board that calls `startDetached` is refused
`no-workstream-core`. The seam is general; the only door through it is
board-shaped — which is the tell that **two capabilities were fused into one
verb.** Spawning a session and filing a task are different things, and
`startDetached` is both, which is why it can be neither cleanly.

And because the seam cannot know whether its caller is a board, it *guesses*:
`create-request-host.ts:198` parses the caller's opaque `input` against the board
dispatch schema to decide whether the call is board work, then validates the
address it found. The 25-line comment above that parse admits what it cannot
prove — that the board making the call is the declaration it matched — and
explains that nothing in the seam identifies the caller.

A named target removes the question. There is nothing to infer from a payload
when the caller says what it wants.

---

## The message protocol

**Added 2026-08-31.** This section is the frame the rest of the document sits in.
It changes no decision below it — it names what those decisions are instances of.

### The inbox already exists

Every transport converges on one seam. `InboundRequestEnvelope`
(`packages/engine/src/transports/types.ts:68`) is the single shape an adapter
builds, and `host.dispatch` is the single door it hands it to — HTTP, chat,
webhook, scheduled, MCP, voice, and `startDetached`, whose own header says
reaching past `host.dispatch` is the thing not to do
(`context/detached-start-operation.ts:18`). Principal resolution, the request
record, streaming, acceptance and concurrency arbitration all happen once, there.

Two consequences are easy to miss:

- **Concurrency config is already an inbox drain policy.** `ConcurrencyFlowView`
  is `{ actions: {…concurrency}, request: { concurrency } }` — a flow-level
  default with a per-entry override, keyed on session, offering `allow` /
  `queue` / `reject`. That is how the inbox drains. It reads as request config
  only because nothing named the inbox.
- **Cron is already a message.** The scheduled adapter builds an envelope at fire
  time and puts it through the same door. The relay epic's issue 4 ("cron as
  scheduled message") is therefore a naming change, not a mechanism.

The mailroom is not a thing to build. It is a thing to stop special-casing.

### What is not unified: routing, not delivery

`resolveActionCore` is five maps keyed on `source`:

| `source` | resolves | input schema owned by |
|---|---|---|
| *(caller)* | `flow.actions[name]` | the author |
| `webhook` | the flow's webhook core | the sender's protocol |
| `chat` | the chat event core | the chat protocol |
| `scheduled` | the schedule core | the framework |
| `workstream` | the one assembled core, **terminal** | the board |

Delivery is uniform. Addressing is five special cases. This document deletes the
last row — but deleting one of five leaves four, and all five exist for the same
reason, so it is worth stating once.

**They exist because for four of them the input schema is not the author's.** A
webhook carries what the sender sends; a schedule carries a fire event; a task
carries the board's dispatch payload. An action's `inputSchema` is
author-declared, so an entry whose schema someone else owns could not live in
`flow.actions` — and each grew its own map instead.

What that actually needs is a **typed inbox entry**, not a separate map. One
namespace; entries differ in who owns the schema and who may address them.

Which settles a question this document left half-open: **`flow.tasks` is not a
third roster seat beside `actions` and `workstream`. It is an inbox entry whose
input schema the framework owns.** `on.webhook` is the same kind of thing. The
seats collapse to one.

### The message types

| Type | Arrives from | Schema owner | Addressed by |
|---|---|---|---|
| user | a caller — HTTP, chat, MCP, voice | the author | `flowKind` + action |
| webhook | an external sender | the sender | flow binding |
| schedule | the scheduler firing | the framework | flow binding |
| task | a board drain | the framework | `flowKind` + task name |
| internal | a block (`ctx.dispatch`) | the author | `flowKind` + action + `session?` |

An adapter is already `{ source, createBindings(host) }` — an immutable factory
that produces routes and puts envelopes through the door
(`transports/types.ts:339`). Formalizing the protocol means an adapter stops
*also* inventing its own addressing convention: it declares a message type, and
the inbox resolves it the same way for every type. The payoff is on the extension
path — adding a transport becomes implementing a contract, rather than writing an
adapter *and* a routing map to go with it.

This is a formalization, not a new mechanism. Most of it is already true. What it
buys is that the next transport cannot quietly add a sixth map.

### An ack is two things, and only one of them is a task

`DispatchHandle` already splits them, and that comment is visibly scar tissue
(`transports/types.ts:179`):

- **Delivery ack** (`accepted`) — the message is discoverable and will not
  silently not exist. Synchronous, every message has it, costs nothing.
- **Outcome ack** (`finished`, or a durable row) — the work settled with a
  result, possibly many requests later.

So: **needs an outcome ⇒ it is a task. Needs only delivery ⇒ nothing is minted.**

That is what removes relay's separate reply plumbing. A send that expects a reply
does not need a deliver-with-output mechanism; it needs somewhere durable to put
the reply and something that can watch it. A board row is exactly that, and the
board already exists.

The distinction has to survive the collapse. A sender that wants nothing back
still needs to know the letter got into the building, and a task row is the wrong
instrument for it — durable, claimable, leased, and none of that is what a
fire-and-forget sender asked for.

### Three things the collapse must not break

1. **Addressability becomes an explicit per-entry declaration.** Today
   `workstream` is safe partly because a caller cannot stamp the source, and the
   source is absent from `PUBLIC_REENTRY_SOURCES`. Flatten the maps and that
   protection leaves with them. Every inbox entry declares who may address it.
   Cheap, but part of the collapse — not a follow-up.
2. **`resolvedActionCore` is a live escape hatch.** A dynamic schedule's core is
   produced at dispatch time by a resolver, so it has no static coordinate to
   resolve from. A static inbox either keeps that hatch or dynamic schedules lose
   their path. Named now rather than discovered later.
3. **There is no second namespace.** If `kind` becomes its own binding table
   (`relay.on[kind]`), the shadow system has been deleted at one layer and
   regrown at the next. *(Refined below: the address is `(type, name)` — one
   key with two segments, not a name plus a parallel concept.)*

---

## The typed entry

**Added 2026-08-31, after review.** This section records decisions taken on the
message-protocol frame above and supersedes it where they disagree.

### The address is `(type, name)`, not a bare name

The section above says *"a message's kind **is** the action name."* That was
aimed at the right target — no parallel `relay.on[kind]` binding table — but it
stated the fix too narrowly. **The address is a pair.**

```ts
flow.user.actions.chat
flow.internal.actions.status
flow.scheduled.actions.dream
flow.webhook.actions.github
flow.task.actions.work
```

This is not the five maps returning. Those are five *mechanisms* — one of them a
router assembled by a fixpoint graph walk — with different resolution rules and
different failure modes. This is **one mechanism with a two-part key.** The rule
the earlier section was reaching for survives intact: there is no second
namespace, because `type` is the first segment of the one address rather than a
parallel concept.

**Nesting: `flow.<type>.actions`, not `flow.actions.<type>`.** The deciding
factor is per-type config, which the second shape has nowhere to put.
`flow.task.retries` and `flow.user.concurrency` want a home, and one already
exists a level up: `flow.request.concurrency` is the all-types default today
(`ConcurrencyFlowView`). So the ladder is **default → per-type → per-action**,
which is the shape already shipped, extended by one rung.

### No fallbacks — and this is a generalization, not an invention

A message addressed to a type that declares no such entry is refused. It does
not fall through to another type's map.

One type already works this way: `WORKSTREAM_SOURCE` resolution is terminal, and
an absent core is a named refusal rather than a fall-through to `flow.actions`.
The change generalizes that rule to all five and deletes the implicit fallback
where any non-special source lands in `flow.actions`.

**The cost is deliberate: a handler reachable from two types is declared twice.**
That is not an edge case — a chat bot serving `user.chat` and `webhook.mention`
is the ordinary case (see the atlas's third stress test). Two entries, one block,
and the block cannot assume which type it runs under. Which decides the next
question.

### The typed envelope lives at the entry, not on `ctx`

Since a shared block may be entered from two types, `ctx.task` cannot be
non-optional. Three shapes were considered:

| | |
|---|---|
| `ctx.task?` everywhere | honest, but every task worker null-checks a field it certainly has |
| `ctx.as("task")`, throwing off-type | the same check, worse ergonomics |
| **envelope handled at the entry** | **chosen** |

The typed part reaches the **entry** as input; blocks below it that need the row
take it as input too. `ctx.task` shrinks to the ambient lifecycle verbs the
substrate genuinely owns — `park`, `heartbeat`.

This is the same rule that killed passing a task into an action wholesale: the
claim envelope is handled before the action is called, rather than pushed onto
implementers. Applied one level in. `sender` gets the same treatment — a field
on the entry's input for `internal` and `task` alike, not `ctx.sender`.

### `task`, not `worker`

Every other type names **what arrives** — a webhook, a schedule, a user message.
`worker` names who handles it. One transport named after its receiver breaks the
set.

### `dispatcher` — a fifth block kind

Block kinds are a locked contract at exactly four (`handler`, `generator`,
`sequencer`, `router`). This proposes a fifth, and the argument is not symmetry
with `router`.

A **router** picks a block to run *here*. A **dispatcher** names a destination to
run *elsewhere* — one destination per invocation. Fan-out still goes through
rows; a dispatcher that fans out is a router with side effects.

Three things a kind buys that a handler-returning-a-message-shape does not:

1. **It avoids shape-sniffing, which is the defect this whole document
   diagnoses.** Recognizing a dispatch by parsing what a block returned is
   `create-request-host.ts:198` again — the seam guessing at its caller. A named
   kind removes the question exactly as a named target did.
2. **A board can see, statically, which workers hand off.** Today inline-vs-
   handed-off is a runtime distinction. With a kind, the roster carries it at
   definition time.
3. **It recovers the build-time check the collapse otherwise loses.** Deleting
   the derived `workstreamBindings` also deletes
   `assertWorkstreamBindingsReachable` (`defineFlow.ts:659`), which catches a
   reachable block declaring a worker the flow never received. A hand-declared
   map cannot reproduce it — there is nothing to compare against. But
   `defineFlow` **can** walk the graph for dispatcher blocks and check each
   target `(type, name)` resolves. Same class of error, caught at the same time,
   without the bubble-up machinery.

So the graph walk survives the collapse — demoted from *routing source* to
*lint*. That is the honest fix for the one capability the deletion was otherwise
giving up.

The taxonomy also reads better as three groups than five flat kinds: leaves that
compute (`handler`, `generator`), a leaf that hands off (`dispatcher`),
composites (`sequencer`, `router`).

### Sessions can be named, so "not found" is a per-entry decision

**A correction.** An earlier claim in this document's discussion — that session
ids are derived and never author-chosen — is false as a general statement.
`handleCreateSession` accepts a caller-supplied id today:

```ts
// packages/engine/src/routes/session-routes.ts:136
const sessionId = getString(body.sessionId) ?? generateId("sess");
```

Derived ids (`deriveChildSessionId`) are the rule for **spawns**, where the
derivation is what makes a spawn idempotent — "first spawn for this row". They
are not the rule for caller-created sessions, and a named session is a
legitimate shape: a channel, `status-updates`.

So the three-way on `dispatchMessage` is:

| `session` | Behaviour |
|---|---|
| omitted | mint one |
| given, found | deliver into it |
| given, not found | **reject** — unless the entry declares itself channel-shaped, in which case create at that name |

Reject is the default because an unknown id is a typo, a stale reference to a
reaped session, or — once a send verb is in a model's hands — a hallucination,
and auto-create turns all three into real work nobody is watching. Reject is also
the recoverable branch: drop the id and mint. A spawn cannot be un-spawned.

**Two things to know before leaning on channels.**
`resolveSessionStorageKey(sessionId, tenantId)` namespaces by **tenant, not
user**, so a slug is tenant-global while the record's `userId` is merely whoever
created it first. Harmless under the same-user invariant; sharp the moment two
people address one channel, which is what channels are for. And a channel wants
`queue` concurrency rather than the `allow` default, or two messages to
`status-updates` interleave.

### Why this reads as message-driven rather than as an event system

The earlier framing for this work was an eventing system bolted onto the
framework. What it became is closer to a message-passing runtime, and the
resemblance is load-bearing in one place: **`handle_call` versus `handle_cast` is
exactly the two-ack cut.** A call expects a reply; a cast does not. Needs an
outcome ⇒ a row; needs only delivery ⇒ nothing minted.

Four places the resemblance stops, recorded because each is a way to reason
wrongly by analogy:

- **The mailbox is durable, not in-memory.** A crashed process takes its mailbox
  with it and supervision restarts from known state. Our rows outlive
  everything, so "let it crash" leaves durable rows something must reclaim. That
  is the lease, and it has no counterpart in the analogy.
- **There is no authorization axis in the analogy.** Any process may send to any
  address it can name. Per-entry addressability, BP-031 and
  `PUBLIC_REENTRY_SOURCES` have no equivalent — so the analogy gives no guidance
  precisely where the risk is.
- **Ordering is not free.** Per-pair ordering is a runtime guarantee there. Here
  it holds under `queue` and not under `allow`, which is the default.
- **Sessions are not cheap processes.** A session carries storage. "One process
  per unit of work" does not port.

---

## The shape

Two capabilities, deliberately **not** one verb. Conflating them is what made the
first draft argue with itself about whether a task board should be mandatory.

| | Spawn a session | File a task |
|---|---|---|
| Reaches | `flow.actions` — public, already exists | `flow.tasks` — private |
| Needs a board? | **No** | **Yes** |
| Claim gate | n/a — nothing is claimed | Mandatory, by construction |
| Who calls it | any block | a board drain |

A *task* is a board concept — a durable row, an assignee, a claim, a lease. Using
the word for anything a block can start would make `tasks` a misnomer on the flow
config. So board-less background work goes through the surface that already
exists.

Both columns are inbox entries — see **The message protocol** above. They differ
in who owns the input schema (the author, or the framework) and who may address
them, not in which registry they live in.

### 1. Spawning a session needs no board

A block spawns (or reuses) a child session and runs an ordinary **action** on it:

```ts
// Inside any block. No board, no task row, no new private surface.
const child = await ctx.sessions.spawn({
  flow: "research",           // omit → this flow
  action: "investigate",      // an entry in that flow's `actions`
  input: { question },
});

child.sessionId;   // dsx_… — a handle, usable again later
child.requestId;
```

The action is one an HTTP caller could already invoke on that session, so this
adds **no reachable surface**. That is the point: spawning is a session-lifecycle
verb, not a routing one, and it needs no private map to be safe.

### 2. `flow.tasks` requires a task board

```ts
const flow = defineFlow({
  kind: "issue-work",
  actions: { start, status },              // public
  tasks: { summarize, implement, review }, // private; assignee → block
  // defineFlow throws if `tasks` is declared and no board is reachable.
});
```

**`tasks` is not a new map — it is the board's `workers` map, hand-declared.**
Today `taskBoard({ workers: { implement: { worker, dispatch: { mode: "detached" } } } })`
already holds assignee → block. The whole bindings apparatus exists only to *lift*
that map to flow level so a restart can re-resolve it from strings. Declaring it
on the flow in the first place deletes the lift.

Dispatch still enters the **board's runner**, never a task entry directly:

```
detached dispatch  →  board runner  →  flow.tasks[row.assignee]
                      ├─ re-read the claimed row
                      ├─ verify attempt / createdAt / incarnationId / lease
                      ├─ mark the task scope
                      └─ re-mint the claim ticket
```

So the four pre-worker guarantees stay exactly where they are, and `flow.tasks`
replaces only the routing table the runner consults. `resolveActionCore` keeps one
terminal branch:

```ts
if (source === TASK_SOURCE) return flow.taskRunner;   // the board's runner
```

Terminal for the reason it is terminal today: a task name may collide with a
public action name, and falling through would hand a framework-stamped dispatch a
caller-addressed handler.

Every entry takes the same fixed input, so the runner can hand off without knowing
what a given task's work looks like:

```ts
type TaskInput<TPayload = unknown> = {
  taskId: string;
  attempt: number;
  createdAt: number;
  incarnationId?: string;   // absent on a row predating the nonce (BP-030)
  payload: TPayload;        // materialized worker input, packed at claim time
};
```

Everything but `payload` is the claim envelope — what the runner compares against
the row it re-reads. It is verified, never trusted.

### 3. Session reuse: filing a follow-up into the session you are in

The handle is a field on the **task row**. A worker that wants its follow-up to
land in the same spawned session names its own session when filing:

```ts
// Inside the `implement` task worker, after opening a PR.
await ctx.tasks.file({
  assignee: "review",
  input: { pr: pr.url },
  session: ctx.sessionId,      // ← continue in THIS spawned session
});
```

Omit `session` and the follow-up gets a fresh child derived the usual way. Pass
it and the next drain routes that row back into the session that filed it —
same checkout, same conversation, same resources.

The board resolves it at spawn:

```ts
// task-board spawn, simplified
const target = row.session
  ? { session: row.session }                        // reuse
  : { flow: ctx.flowKind, seed: { topic, key } };   // derive, as today
await requestHost.startTask({ ...target, taskId: row.id, /* claim envelope */ });
```

Two rules the reuse path owes, both from review:

- **Same lineage.** `lineageId` is stamped at creation and never rewritten, so a
  handle from another lineage would write this run's `sharedToLineage` resources
  into someone else's bucket. Refuse a handle whose lineage differs from the
  caller's. This is not free: `defineTaskCollection` accepts `user`/`org` scope,
  where "the ledger already spans every session the principal touches" — so two
  sessions can drain one board and a row's handle can name a sibling's child.
- **Parentage is immutable.** `GET /sessions/:id/children` keys on
  `parentSessionId`. Set it at creation and leave it; a mutable parentage makes
  the listing stop being historical.

**This is the resume conductor is missing.** Its README: *"No resume. Conductor
starts runs; it does not continue one across a wait… the association a resume
reads from is a typed field on the task."* This is that field, in the substrate
instead of bolted onto one lab's task type.

### 4. How a board knows what it can assign to

**Yes, it is a worker** — a third kind of seat on a roster the board already has.

A board's roster is not new machinery to invent. A skill board already declares
**agents** (prompt-driven, materialized at runtime) and **assignable tools** (called
directly with the task input, no model turn), and every tool that writes an
assignee — `addTask`, `assignTask`, `updateTask` — already *checks the name against
that roster* and returns the available ones on a mismatch, "instead of letting a
mistyped name fall through to the default worker at drain time."

So the question "how does the board know what it can assign to" is already
answered for two seat types. A flow task is the third:

| Seat | Declared as | Runs |
|---|---|---|
| Inline block | `summarize: summarizeBlock` | in the claiming request |
| Tool | any `allowed-tools` key | directly, no model turn |
| **Flow task** | `implement: { task: "implement" }` | **its own spawned session** |

```ts
const board = taskBoard({
  boardId: "issue-work",
  collection: workBoardCollection,
  workers: {
    summarize: summarizeBlock,          // inline — unchanged
    implement: { task: "implement" },   // flow task — this flow's `tasks.implement`
    review:    { task: "review" },
  },
});
```

Three things fall out, and none of them is a new mechanism:

- **The roster check covers it.** `addTask({ assignee: "implemnt" })` is rejected
  with the available names, exactly as a mistyped agent is today.
- **`dispatch: { mode: "detached" }` disappears from this seat.** A flow task is
  detached by definition — running in its own session is what makes it a flow task
  rather than a block. Locality stops being a separate axis to configure and
  becomes a property of the seat type.
- **Open decision 3 answers itself.** The board neither carries every block nor
  references every name: inline seats carry blocks, flow-task seats carry names.
  The block lives in exactly one place either way, and there is no sync burden
  because there is no second declaration to drift from.

#### Within a skill

A skill's roster gains the same seat. Its agents stay inline; work that needs its
own session, its own checkout, or its own long-running conversation names a flow
task instead:

```yaml
# SKILL.md
agents:
  - name: reviewer
    prompt-ref: ./prompts/reviewer.md
tasks:
  - implement          # a `tasks` entry on the flow this skill is bound into
```

```ts
// The generator plans a graph and drains once, exactly as it does today.
await addTask({ assignee: "implement", input: { issue: "FIX-1219" }, deps: [] });
await addTask({ assignee: "reviewer",  input: { issue: "FIX-1219" }, deps: [implementId] });
await runBoard();
```

The generator does not know or care that `implement` runs in a spawned session and
`reviewer` runs inline. It assigns a name; the seat type decides where the work
happens. That is the same indifference the board already gives agents and tools.

#### Cross-flow — the phase-2 shape

A seat naming another flow is the cross-flow case, and it is where the guards in
*What gets more complicated* come due:

```ts
workers: {
  implement: { flow: reviewFlow, task: "implement" },   // phase 2
}
```

Note the bare form (`{ task }`) has no cycle: the board lives inside the flow
whose tasks it names, so naming them by string needs no reference back to the flow
value. The `{ flow }` form takes a *different* flow's value, which is why it is
separable and why phase 1 can ship without it.

**This also settles the spawn rule** (open decision 5). A board may assign to the
flows it declares seats for, and nothing else — board ownership, which was one of
three candidates and is now the only one that needs no new concept. Phase 1's
answer is narrower still: its own flow.

### Worked example: conductor's three phases

What the whole thing looks like assembled — the case that motivated the change.

```ts
// One flow. Three task entries. One board. One host.
const conductor = defineFlow({
  kind: "conductor",
  actions: { seed, wake, status, answer },
  tasks: { spec: specWorker, implement: implementWorker, review: reviewWorker },
});

const board = taskBoard({
  boardId: "conductor",
  collection: workBoardCollection,
  workers: {
    spec:      { task: "spec" },
    implement: { task: "implement" },
    review:    { task: "review" },
  },
});
```

Today this needs three `epic` values and three hosts, because one flow has one
workstream core and two conductor instances share a board. Here the phases are
three rows with three assignees, and `implement` handing off to `review` in the
same checkout is `session: ctx.sessionId` on the file.

`implement` handing off to `review` in the same checkout is `session: ctx.sessionId`
on the file (§3). The board's seats name flow tasks rather than carrying blocks
(§4), so the block lives in one place and there is nothing to keep in sync.

---

## What gets simpler

**Concepts removed outright.** Workstream. Workstream binding. Workstream
coordinate key. Workstream core. Workstream source. That is five nouns for one
idea: *a background run*. After this there is one — a **task**, which the
orchestration package already had.

**One registry instead of two.** `flow.actions` and `flow.tasks` are both
hand-authored maps of name → block, differing only in whether a caller may
address them and whether a claim gate stands in front. Today the second one is a
router assembled from a graph walk over every action root.

**Two capabilities stop being one overloaded verb.** Spawning a session and
filing a task were fused in `startDetached`, which is why the seam had to sniff
its caller's payload to guess which one was happening. Separated, each has an
obvious home: sessions on the action surface, tasks on the board.

**Whole mechanisms delete, not shrink:**

| File | Current size | Fate |
|---|---|---|
| `core/src/types/workstream.ts` | 222 lines | **delete** — bindings, merge, `workstreamBindingKey` and its length-framing |
| `core/src/flow/workstream-core.ts` | 250 lines | **delete** — core assembly, runner dedupe, keyed router |
| `create-request-host.ts` shape-sniff | ~60 lines incl. comment | **delete** — `board-not-routable` and the guess it guards |

Two refusals disappear (`no-workstream-core`, `board-not-routable`) because both
describe failures of inference. A named target either resolves or doesn't.

**The binding-collision machinery goes with it.** Merge-by-object-identity, the
"two boards sharing a `boardId`" throw, the "one board with two distinct runners"
throw, the length-framed key that stops `("a", "b:c")` and `("a:b", "c")`
colliding — all of it exists to keep a derived composite key unambiguous. A
hand-authored map has no composite key.

**Background work stops requiring a task board — without `tasks` pretending to be
board-less.** Today `startDetached` refuses `no-workstream-core` unless a board
contributed bindings, so a flow with no board cannot run anything in the
background at all. Now it can: spawn a session and call an action (§1). A *task*
still means what it has always meant — a claimed row on a board — and `tasks` on
the flow config stays honest about that.

**Conductor's *workstream-core* limits go away.** Its README lists three. Two are
downstream of one-workstream-core-per-flow and go: one phase per conductor, and a
second phase needing its own `epic` value (sharing a board with the first if it
doesn't). Under `flow.tasks` those are three entries on one flow. The third —
"one conductor per host" — is the engine resolving a flow by kind alone; this
sidesteps it (three entries need one instance) rather than fixing it.

**The UI stops needing a second kind of thing.** A spawned session is a session.
The devtool already switches into one with a breadcrumb; what it loses is a tab
that exists to say "these ones are special."

---

## What gets more complicated

Being honest about the cost, because two of these are real.

### 1. The claim gate — the fork this doc opened, now closed

Earlier drafts framed a three-way choice: a registered verifier, a route-through
wrapper, or a mandatory runner brand at `defineFlow`. All three were answers to
"what stops a detached dispatch reaching a bare worker once bindings are gone?"

**Requiring a board dissolves the question.** Dispatch still resolves the board's
runner, exactly as it does today, and the runner still owns the whole pre-worker
sequence on one durable read (`detached-runner.ts`):

1. **Start gate** — re-read the row; abort unless `attempts`, `createdAt` and
   `incarnationId` match, status is still `in_progress`, and the lease is live.
2. **Worker selection** — from the row's own `assignee`. Never the envelope.
3. **Task-scope mark** — without it every item the worker emits is unattributed.
4. **Claim-ticket re-mint** — without it every `completeTask` / `failTask` /
   `updateTask` the worker's model calls runs *unfenced, silently*, because "no
   ticket presented" and "not a claimed worker" are the same condition to the guard.

What changes is only step 2's lookup table: `flow.tasks[assignee]` instead of a
binding resolved from the bubbled map. There is still no path from a detached
dispatch to a bare block, and it is still by construction rather than by
registration — a task entry is reachable only *through* the runner that verified
the claim.

**So the residual cost here is smaller than the earlier drafts claimed, and it is
a different cost.** Not "the guarantee weakens" but "the map and the board must
agree": `flow.tasks` keys and the board's `workers` keys are two declarations of
one fact, unlinked at compile time, failing at dispatch as a task that resolves
nothing. Open decision 3 is whether to close that by having the board reference
flow task names rather than carry blocks of its own.

### 2. Two flows can now share one lineage bucket

`sharedToWorkstream` resources store against the minted `lineageId`. Today a
lineage is single-flow, so two declarations of the same storage key with different
schemas cannot meet. Cross-flow spawn makes that reachable.

**I proposed refusing this at context construction, and that does not work.**
Checked against the code after review raised it: `buildScopeBuckets`
(`createExecutionContext.ts:946`) builds its bucket map from
`sessionResourceConfigs` — *the currently executing flow's* resources — and the
throw it raises fires on two collections **within one flow** sharing a prefix
with conflicting flags. It has no cross-flow visibility, and persisted
resource-state rows carry values and versions but no schema identity, so flow B
has nothing to compare flow A's declaration against.

Closing it properly needs something that does not exist today: a lineage-level
declaration registry, or a stable schema fingerprint stored beside the rows.
That is real work, and it is work cross-flow spawn creates. It moves this from
"small and closable" to a genuine cost of legalizing cross-flow.

### 3. Cross-flow children collide with the child listing's auth boundary

The deletions table below calls the parent-to-child listing "same handler,
honest name." For same-flow children that holds. For cross-flow children it does
not, and the reason is stronger than a filter needing a tweak.

`parentIdentity` (`workstream-routes.ts:218`) conjoins `flowKind: parent.flowKind`
into `SessionStore.list`, and its own contract says why: *"the flow-kind one is
an **authentication** boundary: a public parent authorizes anonymously, so a
child stamped with a protected flow's kind would be handed to a caller hop 2
refuses."*

So cross-flow spawn forces a choice, and both arms cost something:

- **Keep the filter** → cross-flow children vanish from the listing, and the
  session tree the proposal promises is incomplete.
- **Drop the filter** → a public flow spawning into a protected one discloses
  that child to an anonymous caller. That is the disclosure the clause exists to
  prevent.

Neither is acceptable as-is, so cross-flow needs **per-child authorization** on
this route — resolve each child's own flow and authorize it, rather than
authorizing the parent once. That is a new mechanism, not a rename.

### 4. Session-handle reuse needs a check that is not free

I assumed the board's rows all hang off one parent session and checked — they do
not. `defineTaskCollection` accepts `scope: "session" | "user" | "org"`, and at
user/org scope "the ledger already spans every session the principal touches." So
two sessions can drain one board, and a row's stored handle can point at a child
of the *other* session. Reusing it grafts work onto a sibling conversation's
lineage, where its `sharedToLineage` resources then write.

Two options, pick one:

- **Check it.** Refuse a handle whose `lineageId` differs from the caller's.
- **Restrict it.** Handle-reuse only on session-scoped boards (including
  lineage-shared ones), where the parentage genuinely is one root.

Also: `parentSessionId` is what the child listing keys on. Keep it immutable at
creation. A mutable parentage makes the listing stop being historical.

### 5. Cross-flow spawn is phase 2 — a changed recommendation

Cross-flow now belongs to the **spawn** verb (§1), not to tasks: spawning into
another flow's *action* needs no `tasks` entry at all. That makes it cleanly
separable, and two findings say it should be separated.

Both were checked and both hold, and both are cross-flow's alone: the lineage
collision cannot be refused where this doc first claimed (#2), and the child
listing's `flowKind` clause is an authentication boundary (#3). Neither touches
same-flow work.

Meanwhile nothing in v1 needs cross-flow. The conductor case — the change's
motivating example — is three task entries on one flow. A same-flow v1 still
deletes the binding machinery, kills the shape-sniff, and carries session reuse.

*Recommendation: split. What would change my mind: a near-term need that
same-flow entries cannot serve.*

### 6. The spawn verb is wider than `startDetached`

`startDetached` takes a seed and an opaque payload. `ctx.sessions.spawn` takes a
flow and an action — more surface, and both are strings a block author chooses.
The seam still supplies all *authority* (principal, tenant, org, derived session
id); what widens is the *target*.

**"The seam supplies authority" is not a spawn rule, and the proposal owes one.**
Which flows may a given block spawn into? An allowlist on the spawning flow, or a
parent-flow constraint (same flow only). Same-flow-only makes the question
disappear, which is one more argument for deferring cross-flow.

Note the *action* half needs no new rule: a spawned action is one an HTTP caller
could already invoke on that session, so naming it grants nothing new. Only the
*flow* half widens anything.

---

## What must not silently change

`WORKSTREAM_SOURCE` is deliberately absent from the public re-entry allow-list
(`routes/public-reentry.ts`): *"a detached dispatch started by the injection seam.
It has no caller-facing entry at all, so it must have no caller-facing re-entry."*
Retry additionally accepts a caller-supplied `inputOverride`.

**`TASK_SOURCE` must inherit that exclusion.** The goal of "spawned sessions are
callable" is served by calling a *public action* on the spawned session id — an
ordinary `http`-source request, already supported (`execute_action` takes a
`sessionId`). A *task* request stays non-re-enterable from any public surface. The
distinction is the whole reason `flow.tasks` is a separate map.

The allow-list is an allow-list precisely so a new internal source does not
inherit public re-entry by being forgotten. Adding `task` to `PUBLIC_REENTRY_SOURCES`
would be the single most damaging line in this change.

---

## Deletions and renames

| Today | After | Note |
|---|---|---|
| `flow.workstream` | `flow.task.actions` + the board's runner | typed entries, hand-declared — not an assembled router. See §"The typed entry" |
| `flow.workstreamBindings` | — | deleted; nothing bubbles |
| `core/types/workstream.ts` | — | deleted |
| `core/flow/workstream-core.ts` | — | deleted |
| `workstreamBindingKey` | — | deleted; no composite key |
| `declareWorkstreamBindings` | hand-declared `flow.task.actions`; runner keeps the gate | §"more complicated" #1 |
| `assertWorkstreamBindingsReachable` | a `defineFlow` walk for `dispatcher` blocks | demoted from routing source to lint — see §"The typed entry" |
| `WORKSTREAM_SOURCE` (`"workstream"`) | `TASK_SOURCE` (`"task"`) | still terminal, still off the re-entry allow-list |
| `no-workstream-core`, `board-not-routable` | — | inference failures; no longer reachable |
| `GET /sessions/:id/workstreams` | `GET /sessions/:id/children` | honest name; same handler **only for same-flow children** — see §"more complicated" #3 |
| `sharedToWorkstream` | `sharedToLineage` | see below |
| devtool "Workstreams" tab | spawned sessions / session tree | |
| `deriveChildSessionId`, topic/key seed | kept | shrinks to "first spawn for this row" |
| `lineageId`, `lineage-scope.ts`, `StorageScopeType.lineage` | kept, unchanged | FIX-1068 survives intact |

### On `sharedToLineage` — the one rename worth its churn

Not `sharedWithSpawns`. The storage address **is** `lineageId`; `lineage` is
already a `StorageScopeType`; `lineage-scope.ts` is already the module. The
current name points at a concept this proposal deletes, and the accurate name is
already in the codebase. Every other rename here is cosmetic and can wait.

---

## Verification

- **Deletion is real, not moved.** `core/types/workstream.ts` and
  `core/flow/workstream-core.ts` removed; `pnpm typecheck` clean with no
  replacement module of equivalent size. Pass: neither file exists and no new file
  reconstructs a binding registry.
- **The four runner guarantees still hold.** Port `detached-runner`'s existing
  suite (`test/task-board/detached-*.test.ts`) unchanged — the runner keeps its
  role, so these should need no edit beyond the lookup table it consults.
  Pass: same tests green without weakening an assertion — particularly the
  unfenced-settlement case, which fails silently if #4 regresses.
- **`task` is not publicly re-enterable.** A test asserting `retry` / `continue` /
  `resume` refuse a `task`-source request. Pass: three refusals.
- **Cross-flow spawn shares user resources.** A parent in flow A spawns into flow
  B; both read one user-scoped resource with default isolation. Pass: same cell.
- **Lineage-bucket collision refused.** Two flows in one lineage declaring the same
  storage key with different schemas. Pass: refused — **by the registry or
  fingerprint §"more complicated" #2 now says this needs.** The original wording
  here ("refused at context construction") was checked and is unimplementable:
  the bucket map sees one flow. Any phase that legalizes cross-flow owes this
  mechanism first; this bullet does not pass without it.
- **Cross-flow children list without disclosure.** A public flow spawns into a
  protected one; list the public parent's children anonymously. Pass: the
  protected child is refused per-child, not filtered out wholesale and not
  returned. Same-flow listing unchanged.
- **Handle-reuse boundary.** A user-scoped board drained from two sessions; a
  handle from session A reused from session B. Pass: refused (or unreachable,
  depending on which option open decision 2 takes).
- **Conductor's *workstream-core* limits are gone** — scoped deliberately, because
  one of its three is not this proposal's. One phase per conductor and the shared
  board a second `epic` collides with both go away. "One conductor per host" does
  **not**: that one is the engine resolving a flow by kind alone, so two
  instances of one kind are still unaddressable. `flow.tasks` sidesteps it (three
  task entries need one instance, not three) rather than fixing it. Two phases on
  one flow, one host, one board, no
  `epic` split. Pass: `fsdev run` drives both phases; neither claims the other's
  rows.

---

## Open decisions

1. **~~The claim gate.~~ Closed by the author: `tasks` requires a task board.**
   Splitting board-less spawning onto the action surface removes the trade the
   earlier three-way fork was trying to price. Dispatch still enters the board's
   runner, so the four pre-worker guarantees stay construction-time, and
   `flow.tasks` replaces only the runner's lookup table. Recorded here because
   two review rounds argued it; it is no longer open.
2. **Handle-reuse scope.** Lineage check, or session-scoped boards only?
   *Recommendation: lineage check; it is one comparison and it does not restrict a
   board shape people already use.*
3. **~~Does the board carry blocks, or reference flow task names?~~ Both, by seat
   type.** An inline seat carries a block; a flow-task seat carries a name (§4).
   The block lives in one place either way, so the sync burden earlier drafts
   worried about never arises. Left here because two review rounds raised it.
4. **Phase cross-flow spawn out of v1?** Two findings say yes and both are
   cross-flow's alone (§"more complicated" #2 and #3). Nothing in v1 needs it.
   *Recommendation: split.*
5. **~~The spawn rule.~~ Board ownership, via the roster (§4).** A board may
   assign to the flows it declares seats for and nothing else; phase 1 narrows
   that to its own flow. This needed no new concept — the roster check that
   already rejects a mistyped agent name does it. Still open for the *spawn* verb
   proper (§1), which is not board work: which flows may a block spawn a session
   into? *Recommendation: defer with cross-flow — same-flow-only makes it moot.*
6. **Migration.** Nothing is published, so there is no deployed store holding
   workstream addresses (per `state-and-scopes.md`). This can be a clean break
   rather than a dual-read. *Confirm before relying on it.*

---

## Reconciliation with the Relay epic (FIX-1197)

**Added after the epic and its first PR were read.** Everything above was written
before, and this section supersedes it wherever the two disagree.

The relay epic ([PR #1357](https://github.com/fixpoint-labs/flow-state-dev/pull/1357),
approved) and its first implementation ([PR #1527](https://github.com/fixpoint-labs/flow-state-dev/pull/1527),
draft) were designed while workstreams existed — a second class of session that
could be started but not reached. Remove that premise and three of the epic's six
issues change shape. **None of this adds work to the epic; it removes some.**

### The epic already contains `park()`

> **Issue 5 — An exit/park mode for `awaiting_review` — a parked task whose
> request may end.** *Issue 1 does not depend on issue 5.*

That is the settlement mechanism this document proposes, approved and already
scoped as independent of the send verb. Nothing new to specify.

### The epic recorded the question this document answers

> **Where I'm unsure:** which callers use `waitForCondition` versus
> wake-to-a-new-request — specifically a workstream drain.

**A drain parks and ends.** Something later settles the row by presenting the
claim reference. Two of the epic's own deployment facts argue the same way: an
expected wait holds a request open, which a hard request ceiling forbids; and
enough blocked waiters exhaust the worker pool before recipients ever run. A
coding run is hours, so holding a drain open is the pathological case for both.

### Sibling spawn and the send verb are one verb

The epic frames issue 3 as **address supply** — *"it mints the peer the send verb
addresses."* That framing only makes sense while a workstream is a thing you mint
separately. Without it:

```ts
ctx.dispatch({ flow, action, session? })
//   session omitted → mint a session   (was issue 3 / startDetached)
//   session given   → deliver into it  (was issue 1 / sendMessage)
```

Same shape as the HTTP route (`flowKind`, `actionName`, `sessionId?`), which is
the epic's own mailroom premise honored rather than restated: *"a flow is already
a mailroom… what changes is who may put a message through the door, not how it is
routed once inside."* A parallel `relay.on` binding table is the one thing that
does not follow from that premise — a private action is the same entry behind the
same routing.

**The message protocol section above generalizes this.** The epic reached the
mailroom premise for relay specifically; it holds for every message type, and an
internal send is one of five. Relay is not a subsystem next to the transports —
it is the `internal` row of the same table.

### Issue-by-issue

| Epic issue | Becomes | Why |
|---|---|---|
| 1 — address + send verb | merges | one half of the dispatch verb |
| 2 — cross-worker wake channel *(conditional)* | **not built** | it exists only if blocking waits do; park-and-end means the drain never blocks. The epic's own alternative outcome — *"AC 4 is the whole answer and issue 2 has nothing left"* |
| 3 — sibling spawn | **promoted** | not address supply — the spawn primitive, replacing what workstreams did |
| 4 — cron as scheduled message | unchanged | the same verb on a schedule trigger; deferred |
| 5 — park for `awaiting_review` | unchanged | already approved; this is `ctx.task.park()` |
| 6 — watch | open | adjacent to the steering-checkpoint question; semantics sit below the epic doc's fold |

### Same-user is an approved invariant, and it collapses the door

The epic states it twice — *"relay always sends within a single user identity…
user-to-user communication is not possible in the framework"* and *"every send is
same-owner by design invariant."*

PR #1527's door has two axes; the second requires **both ends caller-addressable**,
so a background job neither exposes its public actions nor reaches a peer's. Under
a same-user invariant that is not a privilege boundary — a foreground session
reads pasted content and a background one reads a diff; neither is less trusted
than the other, and both act as the same user. The containment surface is what
the flow declares, not which session it runs in.

**One guard has to move rather than disappear.** `relaySendTool()` puts send in a
model's hands, and session ids are not secret — they appear in items, traces and
prior messages. Recipient scoping belongs on the tool (an allowlist, or ids the
block placed in state), which is where per-tool config already lives.

### What this costs, stated plainly

`sessionKind` in PR #1527 is not a name — it is a persisted field, a `SessionKind`
type, a backfill sweep, `fsdev migrate session-kind`, a refusal path and eight
tests, and the door reads it. If sibling spawn subsumes workstreams, that field
loses its consumer. PR #1527 is a draft at ~4,900 additions across 65 files;
raising this while it is still draft is cheaper than unwinding it after.

### Relay does not steer — and was never meant to

A send creates a **new** request: refused `recipient-busy` under a reject policy,
queued behind the current one otherwise. The epic lists FIX-1179 out of scope,
noting it *"gates steer-with-continuity, not the ask direction."*

Steering needs a checkpoint the running block reads — between sequencer steps, or
between agent turns. That is a shared-scope collection plus a convention, not a
message layer, and it must live at a scope both parties can address (lineage,
user or topic), because cross-session state writes do not exist by design. The
mailbox holds pending mail; session history holds the record, so rows can be
deleted on read.

### Still open

- Park's lease policy — hold (waiting on a person) vs release (waiting on a
  child run). Unverified: whether the substrate can release a lease without
  settling.
- Whether `execute_action` with a `sessionId` already delivers the same
  semantics as a relay send (input item, arbitration, incarnation check). If it
  does, `sendMessage` is provably its in-process twin.
- What the door's first axis protects that `private: true` on an action would
  not.
- Topic/project scope — try it as an org-scoped parameterized collection before
  adding a `StorageScopeType`; whole-scope read cost decides. Note the epic's
  own named gap, *one user with sessions in two orgs*, is adjacent.

**Read against:** the epic PR body and #1527's body, not `spec/_epics/relay.md`
itself. C1–C6 and issue 6's semantics sit below that fold and could change any of
the above.

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
`no-workstream-core`. The seam is general; the only door through it is board-shaped.

And because the seam cannot know whether its caller is a board, it *guesses*:
`create-request-host.ts:198` parses the caller's opaque `input` against the board
dispatch schema to decide whether the call is board work, then validates the
address it found. The 25-line comment above that parse admits what it cannot
prove — that the board making the call is the declaration it matched — and
explains that nothing in the seam identifies the caller.

A named target removes the question. There is nothing to infer from a payload
when the caller says what it wants.

---

## The shape

### 1. `flow.tasks` — a private sibling of `flow.actions`

```ts
defineFlow({
  kind: "issue-work",
  actions: { start, status },       // caller-addressed, public
  tasks:   { spec, implement, review },  // task-addressed, private
})
```

Every entry takes the **same fixed task input schema**. That uniformity is what
makes the map dispatchable from strings alone after a restart, and what lets a
board route to an entry by name:

```ts
type TaskInput = {
  /** The durable row this run is for. */
  taskId: string;
  /** Claim identity — verified against the row, never trusted (see below). */
  attempt: number;
  createdAt: number;
  incarnationId?: string;   // absent on a row predating the nonce (BP-030)
  /** The materialized worker input, packed at claim time. */
  payload: unknown;
};
```

Everything but `payload` is the claim envelope, and it is here rather than inside
`payload` because the framework has to read it without knowing what any
particular task's work looks like. It is what the claim gate compares against the
row it re-reads — see *What gets more complicated* #1, which is where this schema
earns its shape.

`resolveActionCore` keeps one terminal branch, on a renamed source:

```ts
if (source === TASK_SOURCE) return flow.tasks?.[actionName];
```

Terminal for the same reason it is terminal today: a task name may collide with a
public action name, and falling through would hand a framework-stamped dispatch a
caller-addressed handler.

`flow.tasks` is **not** reachable from HTTP or MCP. It is a separate map, so
nothing in it widens the public surface — which is the property `flow.workstream`
exists to hold, kept without the assembly.

### 2. Detach names a flow and a task

```ts
ctx.requestHost.startTask({ flow: "issue-work", task: "implement", input })
// or, continuing an existing spawn:
ctx.requestHost.startTask({ session: "dsx_…", task: "review", input })
```

`flow` and `session` are **exclusive**. A session record already carries its
`flowKind`, so a handle implies its flow; accepting both invites them to disagree.

- `{ flow }` → new spawn. Child session id is still *derived*
  (`deriveChildSessionId`), never caller-supplied. Adoption on an existing derived
  key works exactly as today.
- `{ session }` → continue in a session this lineage already spawned.

Cross-flow spawn is now legal, where today the child always inherits its parent's
`flowKind`. **This costs nothing by default:** `effectiveStorageTuple`
(`defineFlow.ts:700`) defaults `flowIsolation` to `false`, `isolateUserState` and
`isolateOrgState` default to `false`, and BP-027 tells authors not to isolate
reflexively. User- and org-scoped resources are already cross-flow shared. Only a
deliberate `isolateUserState: true` splits, and that author already asked for
per-flow state.

**Cross-flow spawn is separable from the routing fix, and phasing it is worth
considering.** The conductor limits this proposal fixes are solved by `tasks`
being a *map* — spec / implement / review as three entries on one flow — so
cross-flow is not load-bearing for them. Deferring it to a phase 2 would still
delete the binding machinery and the shape-sniff, and would leave out the two
guards it drags in (the lineage-bucket refusal below, and the widened
`startTask` authority). Kept in v1 here because it is the half of the original
idea that makes flows the unit of composition; splitting it is the user's call,
not a correction.

### 3. Session handles live on the task row

A completed task can file a follow-up that runs in the **same spawned session**.
The board stores the handle on the row; the next spawn passes `{ session }`.

This is the resume mechanism conductor is currently missing. Its README names the
gap directly — *"No resume. Conductor starts runs; it does not continue one across
a wait… the association a resume reads from is a typed field on the task"* — and
this is that field, generalized instead of bolted onto one lab's task type.

---

## What gets simpler

**Concepts removed outright.** Workstream. Workstream binding. Workstream
coordinate key. Workstream core. Workstream source. That is five nouns for one
idea: *a background run*. After this there is one — a **task**, which the
orchestration package already had.

**One registry instead of two.** `flow.actions` and `flow.tasks` are both
hand-authored maps of name → `ActionCore`, resolved by the same function, differing
only in whether a caller may address them. Today the second one is a router
assembled from a graph walk.

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

**Detached work stops requiring a task board.** Any flow can declare `tasks` and
any block can start one. Today that is refused.

**Conductor's documented limits go away.** Its README lists three, all downstream
of one-workstream-core-per-flow: one phase per conductor, a second phase needs its
own `epic` value (and shares a board with the first if it doesn't), one conductor
per host. Under `flow.tasks`, spec / implement / review are three entries on one
flow — or three flows — and neither collides.

**The UI stops needing a second kind of thing.** A spawned session is a session.
The devtool already switches into one with a breadcrumb; what it loses is a tab
that exists to say "these ones are special."

---

## What gets more complicated

Being honest about the cost, because two of these are real.

### 1. The claim gate loses its structural guarantee — the significant one

Today `buildWorkstreamCore` routes every detached dispatch to a **board runner**,
never to a worker. `detached-runner.ts` documents the four things that runner does
on one durable read before any worker executes:

1. **Start gate** — re-read the row; abort unless `attempts`, `createdAt` and
   `incarnationId` match, status is still `in_progress`, and the lease is live.
2. **Worker selection** — from the row's own `assignee`, never the envelope.
3. **Task-scope mark** — without it every item the worker emits is unattributed.
4. **Claim-ticket re-mint** — without it every `completeTask` / `failTask` /
   `updateTask` the worker's model calls runs *unfenced, silently*, because "no
   ticket presented" and "not a claimed worker" are the same condition to the guard.

The current design makes that unbypassable by construction: there is no path from
a detached dispatch to a bare worker block, and adding a worker to a board that
already has a runner is covered without anyone remembering to wrap it.

A hand-authored `flow.tasks` entry is just a block. Nothing forces any of the
four. This is a safety property, not board internals — the fence is what stops two
live attempts double-settling a row, and #4 fails *silently*, which is the worst
shape a regression can have.

**Proposed mitigation.** Put the claim envelope (`taskId`, `attempt`, `createdAt`,
`incarnationId`) in the fixed task input schema, and let a board register **one
verifier per board** on the flow. The framework runs the verifier before invoking
the named task entry. That is one registration per board instead of one binding
per worker, and it keeps a single enforcement point.

**A third option, and it is a genuine peer.** `defineFlow` could *reject* any
`tasks` entry that is not a board runner — a brand the board factory stamps on
the runner block, checked at flow-definition time. `core` cannot name a board,
but it can require a symbol, so this is a brand check rather than a registry. It
preserves today's construction-time guarantee exactly, with no verifier and no
bindings.

Its cost is not small and it is not the one raised in review: **it makes a task
board mandatory again.** A flow with no board could not declare `tasks` at all,
which deletes one of the wins claimed above — that detached work stops requiring
a board. So the fork is really *how much does board-less detached work matter*,
and that question deserves to be answered before the gate is.

**This is the part of the proposal that is not obviously simpler.** Options A and
B trade a construction-time guarantee for a dispatch-time one; option C keeps the
guarantee and gives back generality. Weigh it deliberately; do not wave it
through.

### 2. Two flows can now share one lineage bucket

`sharedToWorkstream` resources store against the minted `lineageId`. Today a
lineage is single-flow, so two declarations of the same storage key with different
schemas cannot meet. Cross-flow spawn makes that reachable.

Small and closable: refuse at context construction, exactly as the existing
`flowIsolation` prefix-disagreement check already does
(`createExecutionContext.ts`, the `sharedToWorkstream` bucket map).

### 3. Session-handle reuse needs a check that is not free

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

### 4. `startTask` is a wider verb than `startDetached`

`startDetached` takes a seed and an opaque payload. `startTask` takes a flow or a
session handle plus a task name — more surface, and two of those are strings a
block author chooses. The seam still supplies all *authority* (principal, tenant,
org, derived session id); what widens is the *target*. That is the trade the whole
proposal rests on, and it is the right one — but it is a widening, not a narrowing.

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
| `flow.workstream` | `flow.tasks` | map, not an assembled router |
| `flow.workstreamBindings` | — | deleted; nothing bubbles |
| `core/types/workstream.ts` | — | deleted |
| `core/flow/workstream-core.ts` | — | deleted |
| `workstreamBindingKey` | — | deleted; no composite key |
| `declareWorkstreamBindings` | replaced by the claim gate chosen in open decision 1 | §"more complicated" #1 |
| `WORKSTREAM_SOURCE` (`"workstream"`) | `TASK_SOURCE` (`"task"`) | still terminal, still off the re-entry allow-list |
| `no-workstream-core`, `board-not-routable` | — | inference failures; no longer reachable |
| `GET /sessions/:id/workstreams` | `GET /sessions/:id/children` | same handler, honest name |
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
  suite (`test/task-board/detached-*.test.ts`) onto the verifier path unchanged.
  Pass: same tests green without weakening an assertion — particularly the
  unfenced-settlement case, which fails silently if #4 regresses.
- **`task` is not publicly re-enterable.** A test asserting `retry` / `continue` /
  `resume` refuse a `task`-source request. Pass: three refusals.
- **Cross-flow spawn shares user resources.** A parent in flow A spawns into flow
  B; both read one user-scoped resource with default isolation. Pass: same cell.
- **Lineage-bucket collision refused.** Two flows in one lineage declaring the same
  storage key with different schemas. Pass: refused at context construction.
- **Handle-reuse boundary.** A user-scoped board drained from two sessions; a
  handle from session A reused from session B. Pass: refused (or unreachable,
  depending on which option open decision 2 takes).
- **Conductor's limits are gone.** Two phases on one flow, one host, one board, no
  `epic` split. Pass: `fsdev run` drives both phases; neither claims the other's
  rows.

---

## Open decisions

1. **The claim gate — a three-way fork, and the decision the proposal turns on.**
   **(A) Registered verifier** — one per board, framework-run before the task
   entry; trades the construction-time guarantee for a dispatch-time one.
   **(B) Route-through wrapper** — the flow routes into a board-supplied wrapper;
   preserves the guarantee, costs some of the simplification.
   **(C) Mandatory runner brand at `defineFlow`** — rejects any `tasks` entry that
   is not a board runner; preserves the guarantee outright, but makes a board
   mandatory and so gives up board-less detached work.
   *Recommendation: A, on the judgment that board-less detached work is worth
   more than a construction-time check the verifier reproduces at dispatch. If
   board-less tasks turn out not to matter, C is strictly better than A and this
   flips.*
2. **Handle-reuse scope.** Lineage check, or session-scoped boards only?
   *Recommendation: lineage check; it is one comparison and it does not restrict a
   board shape people already use.*
3. **Do `tasks` live on the flow, or does a board contribute them?** Hand-authored
   is the simplification; board-contributed keeps declaration next to the worker.
   *Recommendation: hand-authored — contribution is what produced the bubbling.*
   The cost to name if it wins: a **sync burden**. The board's assignee/coordinate
   and the `flow.tasks` key have to agree, with nothing linking them at compile
   time — the failure is a dispatch that resolves nothing, at runtime. A shared
   const between the two declarations closes it without reintroducing a graph
   walk; a naming convention does not.
4. **Migration.** Nothing is published, so there is no deployed store holding
   workstream addresses (per `state-and-scopes.md`). This can be a clean break
   rather than a dual-read. *Confirm before relying on it.*

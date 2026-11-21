---
title: "State operations"
type: reference
description: "Every call that changes session, user and org state: what it takes, what it returns, when a write is a no-op, how equality is decided and what two concurrent writers end up with."
---

# State operations

Blocks read state from `ctx` and change it with a small set of calls. State a flow stores for a session, a user or an organization changes only through those calls. The same calls exist on every scope handle: `ctx.request`, `ctx.session`, `ctx.user`, `ctx.org`, and the block-level handles `ctx.sequencer` and `ctx.self`, which hold block state.

The examples use the `support` flow, whose session state counts the tickets handled and keeps a list of the order ids they touched. Which scope to put a field in is on [State and scopes](../concepts/state-and-scopes.md).

```ts title="src/flows/support/blocks/record-ticket.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

export const recordTicket = handler({
  name: "record-ticket",
  inputSchema: z.object({ orderId: z.string() }),
  sessionStateSchema: z.object({
    handled: z.number().default(0),
    orderIds: z.array(z.string()).default([]),
    owner: z.string().nullable().default(null),
  }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ handled: 1 });
    await ctx.session.pushState("orderIds", input.orderId);
    return ctx.session.state.handled;
  },
});
```

## The operations

Every call returns `Promise<boolean>`. `true` means the write went through. `false` means nothing was written. [What a write returns](#what-a-write-returns) says when each happens.

A call marked "Retries on conflict" notices when another writer changed the record after this request read it. It reads the record again, reapplies your change to what it finds, and tries again, up to a retry budget. The other calls hand the store one change that does not depend on what this request read, so there is nothing to retry, with one exception noted on `deleteStateRecord`.

Calls that replace or merge fields:

| Call | Takes | What it does | Retries on conflict |
|---|---|---|---|
| `patchState(updates)` | `Partial<TState>` | Merges the named top-level fields. Other fields are untouched. A nested object you name replaces the stored one whole. | Only when it names two or more fields |
| `patchState(key, updater)` | A field name and `(current) => next` | Stores `updater(current)` under that field. The updater can run more than once, see [Concurrent writes](#concurrent-writes). | Yes |
| `setState(next)` | The whole `TState` | Replaces the state. A field missing from `next` is dropped. | Yes |
| `atomicState(mutator)` | `(state) => Partial<TState>`, synchronous | Calls `mutator` with the current state and merges what it returns, like `patchState`. It cannot remove a field. Can run more than once. | Yes |

Calls that add to a field:

| Call | Takes | What it does | Retries on conflict |
|---|---|---|---|
| `incState(increments)` | `Record<string, number>` | Adds each value to its field. Negative values subtract. An absent or `null` field starts at 0. A multi-field call applies every increment or none. | Only when it names two or more fields |
| `pushState(field, value)` | A field name and one value | Appends `value` to the array in `field`. An absent field becomes `[value]`. One value per call. | No |
| `setStateRecord(field, key, value)` | A field, a key, a value | Sets `state[field][key]`. Other keys of that map are untouched. A field that is not an object starts as an empty map. | No |
| `deleteStateRecord(field, key)` | A field and a key | Removes that key. Other keys are untouched. On request state or the filesystem store it can lose to another writer and return `false`, see [What a write returns](#what-a-write-returns). | No |

### What throws

| Call | Throws | When |
|---|---|---|
| `incState` | `Error`: `incState target "<field>" is not a number (got <type>)` | A named field holds something other than a number, `null` or nothing. Nothing is stored, including the other fields of the call. |
| `pushState` | `Error`: `pushState target "<field>" is not an array (got <type>)` | The field holds a value that is not an array, `null` included. |
| Any call on session state | `ReadonlySessionStateError`, `code` `"readonly-session-state"` | The write would change a top-level `.readonly()` field of the session schema. Those fields are set when the session is created. Exported from `@flow-state-dev/engine/host`. See [Flows and actions](./flows.md). |
| A call marked "Retries on conflict" in the tables above | `ConcurrentModificationError`, `code` `"concurrent_modification"` | The retry budget ran out, see [Concurrent writes](#concurrent-writes) and [Errors](./errors.md). |

Neither of the first two errors has a class; only the message names the field. `patchState` and `setState` do not check values against the schema at runtime. The TypeScript signature does that. A field that two blocks declare with different types throws earlier, when `defineFlow` runs, see [Flows and actions](./flows.md).

## Reading state

`ctx.session.state`, `ctx.user.state` and `ctx.org?.state` are typed `Readonly<TState>`, inferred from the scope's schema. The type is the only guard. Assigning to a property does not throw, changes only this request's copy, and is never stored.

A write shows up in the next read in the same request. A write made in another request does not show up until this request's next write refreshes its copy. A scope with nothing stored reads its schema defaults.

`ctx.org` is typed as optional, but an organization is present on every request. Read it as `ctx.org?.state.licenses`.

## What a write returns

| Return | Means |
|---|---|
| `true` | The write was sent to the store. A [`state_change` item](#the-state_change-item) follows, unless no stream is open for the request, or the call changed only block-state fields declared with `transientSlot()`. It does not promise the stored value differs from before. |
| `false` | Nothing was written and no `state_change` was emitted. |

A write returns `false` when:

| Case | Detail |
|---|---|
| Nothing would change | The proposed state is equal to the current state under the [equality rules](#equality-rules). `patchState({})`, `incState({})`, `incState({ handled: 0 })`, `atomicState(() => ({}))` and `patchState("owner", (c) => c)` all return `false`. |
| The record is gone | On a deleted session, user or organization record, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord` and a `patchState` naming one field return `false` and do not recreate it. The other calls write the record again, or throw `ConcurrentModificationError` when their retries run out. |
| A delete lost a race | Request state and the filesystem store have no one-key delete, so there `deleteStateRecord` writes the whole record, once. If another writer changed the record after this request read it, the write is refused: the call returns `false`, the key stays stored, and calling it again in the same request returns `false` again. Use `atomicState`, which retries, or make the call in a new request. |

What "nothing would change" is checked against depends on the call:

| Call | The no-op check compares with |
|---|---|
| `setState`, `atomicState`, `patchState(key, updater)`, `patchState` naming two or more fields, `incState` naming two or more fields | The stored record. If another request has written since this request read, the write is sent and returns `true`. |
| `patchState({ field: value })` with one field, `incState({ field: n })` with one field, `pushState`, `setStateRecord`, `deleteStateRecord` | This request's own copy. A stale single-field `patchState({ owner: "a" })` that equals the copy is skipped and returns `false`, even though the store holds `"b"`. |

A skipped write does not refresh the copy, so a read after a `false` returns the same state the decision used.

## Equality rules

"Equal" is decided on the whole proposed state against the whole current state.

| Values | Equal when |
|---|---|
| Primitives | `Object.is` agrees: `NaN` equals `NaN`, `+0` does not equal `-0`. |
| Plain objects | Same own keys and equal values, recursively. A key holding `undefined` differs from a missing key. |
| Arrays | Same length and equal elements in order. |
| `Date` | Same `getTime()`. |
| `null` and `undefined` | Never equal. |

State must be JSON-shaped. A function, symbol, `Map`, `Set`, `RegExp`, typed array or class instance in state makes the comparison throw `TypeError` (`deepEqual: <a|b> contains a <kind>; state must be JSON-shaped.`), unless both sides are the identical value. Nesting past 32 levels throws `RangeError`.

## Concurrent writes

Two blocks, or two requests, write the same field at the same moment. The outcome depends on the call.

| Call | Two writers, same field |
|---|---|
| `incState({ field: n })`, one field | Both land. The store adds both. |
| `pushState(field, value)` | Both land. Order between them is not promised. |
| `patchState({ field: value })`, one field | Last write wins. Both calls return `true`. |
| `setStateRecord(field, key, value)` | Last write wins on that key. Other keys survive. |
| `deleteStateRecord(field, key)` | The key is removed. Other keys survive. On request state or the filesystem store, if the other writer changed the record after this request read it, this call returns `false` and the key stays. |
| `setState(next)` | `next` replaces the record as written, including another writer's fields that `next` lacks. |
| `patchState({ a, b })`, two or more fields | The fields you name overwrite theirs. Fields you did not name survive, even ones the other writer changed. |
| `incState({ a, b })`, two or more fields | Both sets of increments land. |
| `patchState(key, updater)`, `atomicState(mutator)` | The updater runs again on the winning value; what it returns is stored. |

Except for `setState`, and `deleteStateRecord` on request state or the filesystem store, writes to different fields, or to different keys of one map, never disturb each other.

A call marked "Retries on conflict" runs the updater or mutator again when another writer got there first. So an updater should be a pure function of the state it receives and write nothing declared outside it. To report what an updater decided, use `withOutcome(run, updater)` from `@flow-state-dev/core/helpers`. `run` is the write, such as `(m) => ctx.session.atomicState(m)`, and `updater` returns `{ state, result }`. `withOutcome` hands `state` to the write and resolves to `Promise<TResult | undefined>`: the `result` of the updater's last run, the one whose `state` the call used, or `undefined` if the updater never finished a run.

```ts title="src/flows/support/blocks/claim-ticket.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

export const claimTicket = handler({
  name: "claim-ticket",
  inputSchema: z.object({ worker: z.string() }),
  sessionStateSchema: z.object({ owner: z.string().nullable().default(null) }),
  execute: async (input, ctx) => {
    const claimed = await ctx.session.patchState("owner", (current) => current ?? input.worker);
    return { claimed };
  },
});
```

If `worker-a` stores itself between `worker-b`'s read and write, `worker-b`'s updater runs again, gets the same `"worker-a"` back, and the call returns `false`. If `worker-a` stored itself before `worker-b` read, the updater runs once and the call also returns `false`.

When retries run out, the call throws `ConcurrentModificationError` (see [Errors](./errors.md)). The retry count and the wait between tries are set per scope in the flow definition; request state has no such setting. See [Flows and actions](./flows.md).

On the built-in stores (in-memory, filesystem, SQLite and Postgres), the calls marked "No" in the tables above never throw `ConcurrentModificationError`. Which operations a store supports is on [Stores](./stores.md).

### Ordering by scope

| Scope | Order of writes | Can throw |
|---|---|---|
| `session`, `user`, `org` | No queue. Writes interleave, within one request and across requests. | `ConcurrentModificationError` |
| `request` | Writes in one request run one at a time, in the order submitted, each stored before the next. Any number of parallel writes in one request all commit. | `ConcurrentModificationError`, only when a second run of the same request writes at the same time, as when recovery restarts a request whose first run has not stopped |
| `ctx.sequencer`, `ctx.self` (block state) | One at a time in submission order, each mutator run once. Writes never conflict. | A timeout error, below |

Block state belongs to one run of its block and is not a scope record, so no other request can see it. A sequencer's state is written into its checkpoints, and a resumed run restores it from the latest one, except fields marked `transientSlot()`, which are left out and reset to their defaults. `ctx.self` state of a handler is not checkpointed and is gone when the handler finishes. A write has a time budget, queue wait plus mutator run time, and fails with an error whose `code` is `"SCOPE_MUTATION_TIMEOUT"` when it runs out. A mutator that timed out keeps running and commits if it finishes, so a caller that retries should make the write safe to repeat. The budget is `request.mutationTimeoutMs` in the flow definition, see [Flows and actions](./flows.md).

## `transientSlot`

`transientSlot(schema)` marks a state field. The field holds its value for the run and later steps read it. It emits no `state_change` and is left out of `state_snapshot`. In a patch that writes both transient and normal fields, the transient keys are stripped from the `state_change` delta and the rest persists. Apply it last in the schema chain. It works on any block's state, not only a sequencer's.

## The `state_change` item

Each write that returns `true` emits one `state_change` item on the request's stream. The delta is what you passed, not what the store holds afterwards.

| Call | `operation` | `path` | `delta` |
|---|---|---|---|
| `patchState({ ... })` | `"patch"` | none | The object you passed |
| `patchState(key, updater)` | `"patch"` | `key` | `{ path: key }`; the computed value is not included |
| `setState(next)` | `"set"` | none | The whole `next` |
| `incState({ field: n })` | `"increment"` | none | The increments you passed, not the new totals |
| `pushState(field, value)` | `"push"` | `field` | The one value appended |
| `setStateRecord(field, key, value)` | `"patch"` | `"field.key"` | `{ field: { key: value } }` |
| `deleteStateRecord(field, key)` | `"delete_key"` | `"field.key"` | `{ field: key }` |
| `atomicState(mutator)` | `"atomic"` | none | None |

The item's other fields, and which items the browser applies, are on [Items and the stream](./items.md).

## Resource state

Resources have their own operations with the same names. Every one retries on conflict and refuses a result that fails the resource's `stateSchema`. See [Resources and collections](./resources.md).

## Next

- [State and scopes](../concepts/state-and-scopes.md): which scope a field belongs in, and what the browser sees of it.
- [Concurrency policies](./concurrency.md): how two requests on one session are arbitrated before their writes meet.
- [Errors](./errors.md): every error code and which are retryable.
- [Items and the stream](./items.md): the `state_change` item among the rest.

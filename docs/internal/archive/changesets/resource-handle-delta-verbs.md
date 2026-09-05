---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Add `incState` and `pushState` to resource handles (FIX-1269), so incrementing a counter or appending to a list on a resource no longer needs a hand-written read-modify-write. Both `ResourceRef` and `ResourceContext` gain them, under the same names sequencer state already uses, and they return `void` like the other resource mutators.

Each call is a single guarded mutation, so two callers incrementing one counter both land — on the memory, SQLite and Postgres stores. The filesystem store guards a record's read-check-write with a per-id in-process lock, so two processes sharing one directory can still lose an increment. Nothing on the store interface changes, and concurrent writers still retry: the gain is that one intent stops needing two APIs, not throughput.

They refuse rather than corrupt, and the refusal is a runtime one. Incrementing a field that holds something other than a number, or appending to one that holds something other than a list, throws `FlowError` (`code: "resource_delta_refused"`) and leaves the stored value alone; a multi-field `incState` with one wrong-typed field applies none of it. An absent or `null` field is that field's empty state, not a wrong kind of value, so it starts from `0` / `[]`. `incState` also refuses a result that is not finite, because `z.number()` accepts `±Infinity` while the JSON-serializing stores turn it into `null` — two finite operands can overflow to it with no non-finite argument anywhere.

There is compile-time narrowing on top of that, but only where the state type is written out: on a `ResourceRef<UsageState>` or `ResourceContext<UsageState>`, `incState` takes only the number-valued fields and `pushState` only the array-valued ones with their element type. A handle read off `ctx.resources.<name>` is `ResourceRef<any>`, so that narrowing does not apply there and the runtime refusal is the guarantee — expect no build error on that path.

"Leaves the stored value alone" holds even when the resource's `stateSchema` normalizes what it parses. A schema that fills in a default the stored row predates, or drops a key the schema no longer declares, does not get to rewrite that row on the way through a call that refused: a refused write persists nothing, bumps no version, and announces no change.

Every way a delta can fail — the wrong-kind refusal above and a result the `stateSchema` rejects — is decided against the row the write would actually have committed against, not against whatever the calling context had cached. A delta whose result is only invalid because that cached value was stale re-runs against the live row and lands; one that is still invalid there fails exactly as before.

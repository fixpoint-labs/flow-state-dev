---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Add `incState` and `pushState` to resource handles (FIX-1269), so incrementing a counter or appending to a list on a resource no longer needs a hand-written read-modify-write. Both `ResourceRef` and `ResourceContext` gain them, under the same names sequencer state already uses, and they return `void` like the other resource mutators.

Each call is a single guarded mutation, so two callers incrementing one counter both land — on the memory, SQLite and Postgres stores. The filesystem store guards a record's read-check-write with a per-id in-process lock, so two processes sharing one directory can still lose an increment. Nothing on the store interface changes, and concurrent writers still retry: the gain is that one intent stops needing two APIs, not throughput.

The verbs are typed against the resource's own state shape, and they refuse rather than corrupt. Incrementing a field that holds something other than a number, or appending to one that holds something other than a list, throws and leaves the stored value alone; a multi-field `incState` with one wrong-typed field applies none of it. An absent or `null` field is that field's empty state, not a wrong kind of value, so it starts from `0` / `[]`. `incState` also refuses a result that is not finite, because `z.number()` accepts `±Infinity` while the JSON-serializing stores turn it into `null` — two finite operands can overflow to it with no non-finite argument anywhere.

"Leaves the stored value alone" holds even when the resource's `stateSchema` normalizes what it parses. A schema that fills in a default the stored row predates, or drops a key the schema no longer declares, does not get to rewrite that row on the way through a call that refused: a refused write persists nothing, bumps no version, and announces no change.

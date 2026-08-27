---
"@flow-state-dev/engine": minor
---

Resource writes no longer let a state schema move the stored value on its own.

A resource's state is parsed on the way out as well as on the way in, so any rewrite the schema performs ran once per read-modify-write cycle. For an idempotent rewrite — filling a `.default()`, stripping an undeclared key, normalizing a retired enum value — that is harmless and is how an older row picks up a field its schema gained later. For a `.transform()` that returns something new on each pass it was not: the stored value climbed on every write even when the caller never touched that field, the write reported success, and the value read back looked plausible because the same shift re-applied on the way out.

A write whose parsed result does not parse back to itself is now refused with a `ValidationError` naming the resource and, where there is one, the field that moved (FIX-1260). When a write's parse yields `null`, the value actually stored is the cleared `{}`, so `{}` is what has to settle: `collection.create(key, seed)` is refused when the schema parses `seed` away to `null` and cannot produce a stable object from `{}`, which is the answer a bare `collection.create(key)` already gave. An ordinary `z.object({…}).nullable()` parses `{}` to `{}`, so the documented `setState(null)` reset is unaffected. Rows written before this change are read normally and converge on their next successful write.

Every resource write now goes through one parse path, `parseResourceWriteState`. Two consequences worth reading before you upgrade:

- **`POST /sessions/:id/resources/:ref` refuses a seed it cannot store.** The create route carries no initial state, so it seeds the row from the schema's parse of `{}`. That seed is now held to the same bar as any other write, and a schema that cannot produce a valid, stable object from `{}` gets `400` instead of `201`. A collection whose `stateSchema` has a required field with no `.default()` was previously created over HTTP with a `{}` state row that failed its own schema; it is now refused. Give the field a `.default()` to restore creation.
- **`collection.create()` and `collection.upsert()` report schema failures in the same words as every other write.** The messages changed from `Namespace "<pattern>" create("<key>") state validation failed…` and `Namespace "<pattern>" upsert("<key>") state validation failed…` to `Resource "<storage-key>" write failed stateSchema validation at "<field>": …`. The `create` / `create(replace)` / `upsert` distinction is no longer in the text; the storage key identifies the instance.

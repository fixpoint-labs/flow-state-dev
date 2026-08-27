---
"@flow-state-dev/engine": patch
---

Resource writes no longer let a state schema move the stored value on its own.

A resource's state is parsed on the way out as well as on the way in, so any rewrite the schema performs ran once per read-modify-write cycle. For an idempotent rewrite — filling a `.default()`, stripping an undeclared key, normalizing a retired enum value — that is harmless and is how an older row picks up a field its schema gained later. For a `.transform()` that returns something new on each pass it was not: the stored value climbed on every write even when the caller never touched that field, the write reported success, and the value read back looked plausible because the same shift re-applied on the way out.

A write whose parsed result does not parse back to itself is now refused with a `ValidationError` naming the field, on single resources, collection instances, and `create` alike (FIX-1260). Rows written before this change are read normally and converge on their next successful write.

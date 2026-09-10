---
"@flow-state-dev/workforce": minor
---

A delegated agent now returns the result shape it declared on its `outputSchema`, where it previously always returned text (FIX-1337).

An agent whose declared `outputSchema` can parse to a value JSON cannot carry — an output transform such as `z.string().transform(...)`, or a `z.date()` / `z.bigint()` — is now refused by name, where it previously loaded (FIX-1337).

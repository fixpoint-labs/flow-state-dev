---
"@flow-state-dev/workforce": minor
---

A delegated agent now returns the result shape it declared on its `outputSchema`, where it previously always returned text (FIX-1337).

An agent whose declared `outputSchema` contains an output transform (for example `z.string().transform(...)`) is now refused by name, where it previously loaded (FIX-1337).

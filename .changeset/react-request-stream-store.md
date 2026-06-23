---
"@flow-state-dev/react": minor
---

`useRequestStream` now streams message and reasoning text token-by-token (it previously only showed text once the item completed), and takes its target as `source: { requestId }` or `source: { response }` (an inline POST stream) instead of a flat `requestId`. New options: `filter`, `includeTrace`, `reconnectToken`, `flush` ("raf" | "immediate"), and `enabled`. Migrate callers from `{ requestId }` to `{ source: { requestId } }`.

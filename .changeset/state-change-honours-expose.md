---
"@flow-state-dev/engine": patch
---

Streamed `state_change` items for session, user and org state now carry only the fields the scope's `client.expose` lists, the same fields client data shows. A field kept out of `expose` no longer reaches the browser through the request stream, a replay of it, or a `?include=trace` stream. A change to an unexposed field still streams a `state_change` (so views know the scope changed) with no `path` or `delta`. A flow with no `expose` list streams no state values (FIX-2730).

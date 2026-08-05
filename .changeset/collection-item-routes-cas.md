---
"@flow-state-dev/engine": minor
---

The collection-item `POST` and `DELETE` routes now win the state key before
touching content, so either can return `409 Conflict`.

Both HTTP routes wrote the two stores without a version. `POST` read the key,
saw nothing, wrote content, then wrote state — so two clients creating the same
topic at once both got `201`, and the stored body could belong to whichever
finished second while the state row belonged to the other. `DELETE` deleted
state and content in one unordered pair, so a request built against a view that
had since changed removed whatever generation was live at the time, in both
stores.

`POST` now inserts the state row create-if-absent and writes content only after
that commits. One client gets `201`, the other gets `409` and never reaches the
content store, so the persisted body always belongs to the client that won the
topic. The conflict is final: a losing create is not retried into an overwrite.

`DELETE` now deletes state conditionally on the version the request actually
read, and deletes content only after that commits. A delete that lost its race
returns `409` and leaves the item completely intact, content included. Deleting
a topic that does not exist is still `200`, so retrying a completed delete stays
safe.

Both are new failure modes for clients: `DELETE` previously returned `200`
unconditionally. A 409 means the client's view is stale, not that the operation
is impossible — re-read and decide again.

Two limits are worth stating rather than implying. A create is still two writes
to two stores: if the state row commits and the content write then fails, the
item exists with empty content. It stays visible in listings and a `PATCH` to
its content endpoint repairs it, but that needs the collection to grant
`client.content.update` — a collection granting `create` alone leaves an
authorized client holding an item it can neither fill nor remove. Grant `update`
alongside `create`; the resource client-access guide now says so. And on the
delete side, an item recreated in the narrow window between the state delete and
the content delete loses its new content to the delete that is already in
flight. Content is deliberately last-write-wins, so no version on the state row
fences it; sequencing the two narrows the window to two statements rather than a
whole request.

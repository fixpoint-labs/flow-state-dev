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

`DELETE` now deletes state conditionally on the version it read while serving
the request, and deletes content only after that commits. If the row moves in
between, the request returns `409` and leaves the item completely intact,
content included. Deleting a topic that does not exist is still `200`, so
retrying a completed delete stays safe.

`DELETE` previously returned `200` unconditionally, so the 409 is a new failure
mode for clients — worth retrying, since it means something touched the item
mid-request rather than that the delete is impossible.

What the delete check covers is the route's own window, between its read and
its write. It is not a client precondition: a `DELETE` issued from a view the
client fetched earlier still reads the live row and removes it. Accepting a
caller-supplied expected version is a separate piece of surface these routes do
not have.

These limits are worth stating rather than implying, because ordering state
before content means an item is briefly live while its content is still being
written.

If the state row commits and the content write then fails, the request fails —
but the item exists anyway, because the state row committed first. A failed
create is therefore not a no-op: the item is live and listable, and a retry of
the same topic gets an honest `409`. There is no content row, so reading the
item's content returns `null` rather than an empty string. A `PATCH` to its
content endpoint repairs it, but that needs the collection to grant
`client.content.update` — a collection granting `create` alone leaves an
authorized client holding an item it can neither fill nor remove. Grant `update`
alongside `create`; the resource client-access guide now says so. None of this
applies to a collection declaring `contentTemplate` or `contentTemplateRef`,
whose content renders from state and never reads the content row.

The other windows produce no error at all, which is what makes them the ones
worth stating. If a `DELETE` lands in that same window, the create's body is orphaned behind
the tombstone, and a later create of the topic **that sends no content** revives
the row over it — so a deleted generation's content can read as current. Sending
`content` with every `POST` avoids it. If a `PATCH` lands in the window, it is
acknowledged `200` and then overwritten by the create still in flight. And on
the delete side, an item recreated between the state delete and the content
delete loses its new content to the delete already in flight.

All of these are the same shape: content is deliberately unversioned, so no
predicate on the state row fences a write to it, and a version cannot tell a
create's own row from a successor generation at the same number. Sequencing
narrows each window to two statements rather than a whole request; closing them
is cross-record atomicity, which these stores do not provide.

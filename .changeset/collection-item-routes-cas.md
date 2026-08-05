---
"@flow-state-dev/engine": minor
---

The collection-item `POST` and `DELETE` routes now settle the item's state before
touching its content, so both can return `409 Conflict`.

`POST` returns `409` when the topic already exists, including when two clients
create it at once: one gets `201`, the other `409` without writing any content,
so the stored body always belongs to the winner. `DELETE` returns `409` when the
item changed while the request was being served, and leaves the item intact in
both stores. Deleting a topic that does not exist is still `200`.

**Migration.** `DELETE` previously returned `200` unconditionally, so its `409`
is a new failure mode. It means something touched the item mid-request, not that
the delete is impossible — re-read and decide again. Note that the check covers
the server's own read-to-write window, not the age of your data: a `DELETE` built
from a view you fetched earlier still removes whatever is live now.

**A failed `POST` is not a no-op.** State commits before content, so if the
content write fails the request errors *and the item still exists* — live,
listable, and with no content row, which reads back as `content: null` rather
than `""`. Retrying the topic gets a `409`; repair it with `PATCH` instead. That
needs the collection to grant `client.content.update`, so grant `create` and
`update` together — `create` alone leaves a client holding an item it can neither
fill nor remove. (A collection using `contentTemplate` / `contentTemplateRef`
still reads fine, since its content renders from state, but the failed request
and the live item are the same.)

**Two windows stay open**, and neither reports an error. A `DELETE` overlapping a
create can leave that create's body behind, and a later create of the same topic
*that sends no content* will then show the old body as its own — sending
`content` with every `POST` avoids it. A `PATCH` overlapping a create is
acknowledged `200` and then overwritten. Both are consequences of state and
content being separate stores; the reasoning and the full residual table are in
the resources architecture reference and the client-access guide.

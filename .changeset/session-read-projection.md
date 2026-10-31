---
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": patch
---

The session routes now send a session as a client may see it (FIX-1588). `GET /sessions/:id`, the session listing, and the create and metadata-edit responses carry only the `state` fields the flow names in `session.client.expose` or declares readonly (empty when there are none), and no longer include the record's `journal` or stored `resources`. Server-side code that needs the whole record reads the session store.

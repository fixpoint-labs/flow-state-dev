---
"@flow-state-dev/engine": patch
---

Stopping a request whose approval was already granted, but which has not run again yet (its process died before it continued, so it waits on the durability sweep's re-drive), now stops it: the abort route answers `204` and `ctx.session.stopRequest` answers `"stopped"`, the request ends `aborted`, and the approved step never runs. Before, the stop answered `409` ("stop it again") every time until the sweep re-drove the request, which then ran the approved step and finished `completed`. The gate then records only the stop: the person's answer, and any form data they sent, is not kept. The same holds for a stop recorded on such a request before the sweep reaches it (FIX-2108).

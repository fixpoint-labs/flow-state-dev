---
"@flow-state-dev/engine": patch
---

Another user's request id is now answered as not found on the request reads, and a session's reads keep to the session's own flow (FIX-1046). With a principal resolver configured, `GET /:flow/requests/:id/status` and `GET /:flow/requests/:id/stream` answer another user's request exactly as they answer an id nobody has used (`404`, or an empty `200` on a stream resumed with `starting_after` or `Last-Event-ID`), instead of `403 Caller is not the owner`. Abort, resume, retry and continue still answer `403`. The session snapshot with items (`/sessions/:id/state?include_items=true`) and the session stream now filter a session's requests by the session's flow kind and owning instance, as the request listing already did, so a session stored before instance-bound admission that holds another flow's run no longer serves that run's items.

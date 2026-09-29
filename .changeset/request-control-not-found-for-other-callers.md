---
"@flow-state-dev/engine": patch
---

The routes that act on an existing request (retry, continue, resume and abort) now answer a request the caller cannot reach exactly as they answer an unused id: `404 {"error":"Request \"<id>\" not found"}` (FIX-1021). With a principal resolver configured, another user's request gets that answer instead of `403 Caller is not the owner`. Resume and abort now also answer another tenant's request that way, as retry and continue already did, so abort no longer stops a run in another tenant. Abort's answer for an unknown id changes from `Request "<id>" is not in progress` to the shared `not found` text; the status stays `404`. The request status and stream routes are unchanged. Stored records need no migration.

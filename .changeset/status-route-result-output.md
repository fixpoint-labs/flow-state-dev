---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

`GET /api/flows/:flowKind/requests/:requestId/status?include_result_output=true` returns the request's stored action result, read by the request's id, so a caller holding a request id reads what the action answered without listing the session's requests (FIX-2455). The snapshot gains an optional `result` (`output`, `outputNotRecorded`, `error`, `hasOutput`), the same projection `GET /sessions/:id/requests` sends with that flag; `RequestStatusSnapshot` in `@flow-state-dev/core/types` declares it. Without the flag the snapshot is unchanged and carries no `result`.

Docs: packages/engine/README.md (the read-only status endpoint row: `include_result_output=true` adds the stored `result`, same shape as the session request list), apps/docs/docs/server/connection-resilience.md (the status endpoint step: the optional `result` behind the flag), apps/docs/docs/api/client.md (the `RequestStatusSnapshot` shape gains an optional `result`)

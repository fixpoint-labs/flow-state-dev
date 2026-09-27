---
"@flow-state-dev/store-postgres": patch
---

Add four indexes that serve the session stream's repeated reads, a pair for each: `idx_requests_session_updated` on `requests(session_id, updated_at)` and `idx_sessions_parent_updated` on `sessions(parent_session_id, updated_at)` for a caller with no tenant, and `idx_requests_session_tenant_updated` on `requests(session_id, tenant_id, updated_at)` and `idx_sessions_parent_scope_updated` on `sessions(parent_session_id, tenant_id, org_id, updated_at)` for a caller bound to a tenant. They are built `CONCURRENTLY` at schema init, so writes are not blocked, and an invalid one left by an interrupted build is dropped and rebuilt on the next init. Also add the extended statistics object `stat_requests_session_tenant` on `requests(session_id, tenant_id)`, so the planner knows a session's requests share its tenant and uses the tenant-bound index; it changes estimates only and is filled by `ANALYZE`. No data changes (FIX-1609).

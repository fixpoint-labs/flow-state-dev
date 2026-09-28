---
"@flow-state-dev/store-sqlite": patch
---

Add two indexes that serve the session stream's repeated reads: `idx_requests_session_tenant_owner_updated` on `requests(session_id, tenant_id, user_id, org_id, updated_at)` for one session's requests, and `idx_sessions_parent_tenant_owner_updated` on `sessions(parent_session_id, tenant_id, user_id, org_id, updated_at)` for one parent's runs, each newest-updated first. Each read now walks what changed in the session it follows, rather than sorting the session's history or walking rows another owner or organization keeps under the same id. Created with `IF NOT EXISTS` on the next open; no data changes (FIX-1609).

---
"@flow-state-dev/store-postgres": patch
---

Add two indexes that serve the session stream's repeated reads: `idx_requests_session_updated` on `requests(session_id, updated_at)` and `idx_sessions_parent_updated` on `sessions(parent_session_id, updated_at)`. They are built `CONCURRENTLY` at schema init, so writes are not blocked, and an invalid one left by an interrupted build is dropped and rebuilt on the next init. No data changes (FIX-1609).

---
"@flow-state-dev/server": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Multi-tenant deployments now isolate session data by tenant automatically. When a request carries a tenant id (the `x-tenant-id` header, configurable via `createFlowApiRouter({ tenantIdHeader })`), the session record, session-scoped resources, and cross-turn request history are namespaced by tenant — two tenants sharing a session id no longer share data. User and org scopes stay shared across tenants by design. Single-tenant apps that never send the header are unaffected, and the SQLite and Postgres adapters add the `tenant_id` column through an idempotent migration that needs no manual step.

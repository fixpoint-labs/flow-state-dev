---
---

FIX-882: Knowledge Hub lab capture layer. Added the `logActivity` MCP tool and a user-scoped `inbox` resource collection to the private `@flow-state-dev/knowledge-hub` lab, with a deterministic (non-LLM) mailroom pass at capture time (normalization, wall-clock stamping, sha256 fingerprint idempotency) and a `listInbox` read-back for inspection. Replaces the scaffold `ping` action; HTTP access fails closed behind `KH_MCP_SECRET`. No publishable package surface changes.

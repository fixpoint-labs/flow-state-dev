---
"@flow-state-dev/engine": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/mcp": patch
---

A queue adapter can supply a shared lease backend (`WorkerAdapter.leaseBackend`) so a session's `queue` / `reject` concurrency policy holds across every process of a deployment, and every transport answers a refusal that arrives after dispatch the same way it answers one thrown from it (FIX-1634).

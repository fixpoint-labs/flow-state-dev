---
"@flow-state-dev/workforce": patch
---

The workforce client gains `listWorkerSessions(worker)`: the caller's conversations with one worker on its current flow, as `WorkerSessionEntry` rows (`{ session, isDefault }`). The default conversation, the one `ensureWorkerSession` returns, comes first; the rest follow by latest activity. A task's session, a conversation's delegate session, a workstream lead's session and the project coordinator's session for a project are left out, and listing never creates a session (FIX-2158).

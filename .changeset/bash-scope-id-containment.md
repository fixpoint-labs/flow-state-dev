---
"@flow-state-dev/tools": patch
---

A caller-supplied id can no longer put a bash workspace outside the workspaces root (FIX-150).

`requestId` and `sessionId` reach the tool from the request body — the action route validates only that they are strings — and the resolved scope id becomes a path segment under `.fsdev/workspaces/`. A traversal-shaped id therefore placed a run's workspace wherever the caller liked. `userId` and `orgId` come from a verified principal, but fall back to the session id when absent, so every scope was exposed (BP-031).

Scope ids are now normalized to a safe directory name. Ordinary ids (`req_x1y2`, `sess_abc`) are already in the safe set and pass through unchanged, so no existing workspace is renamed. Anything else is rewritten and given a digest of the original, so two hostile ids differing only in unsafe characters cannot collapse onto one workspace.

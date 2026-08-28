---
"@flow-state-dev/tools": patch
---

A caller-supplied id can no longer put a bash workspace outside the workspaces root (FIX-150).

`requestId` and `sessionId` reach the tool from the request body — the action route validates only that they are strings — and the resolved scope id becomes a path segment under `.fsdev/workspaces/`. A traversal-shaped id therefore placed a run's workspace wherever the caller liked. `userId` and `orgId` come from a verified principal, but fall back to the session id when absent, so every scope was exposed (BP-031).

Scope ids are now normalized to a safe directory name. Ordinary ids (`req_x1y2`, `sess_abc`) are already in the safe set and pass through unchanged, so no existing workspace is renamed. Anything else is rewritten and given a digest of the original, so two hostile ids differing only in unsafe characters cannot collapse onto one workspace. Rewritten ids carry an `enc-` prefix that a passed-through id can never have: without the separation an encoding is itself a valid unencoded id, and an attacker who wants a victim's `a/b` workspace computes the digest and submits `a-b-<digest>` as their own id. Pass-through is also length-bounded, since an over-long id is a filename the first write fails on.

**Workspace keys and directories are scoped to the tenant.** The registry key and the workspace path are prefixed with the org and user from the verified principal, so two tenants naming the same `requestId` or `sessionId` — both of which arrive on the request body — no longer share a live sandbox or a directory of files. Existing local workspaces under `.fsdev/workspaces/` are not migrated: a run whose tenant prefix is new starts in a new, empty directory.

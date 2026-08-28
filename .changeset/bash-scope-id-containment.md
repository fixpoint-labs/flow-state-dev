---
"@flow-state-dev/tools": patch
---

A caller-supplied id can no longer put a bash workspace outside the workspaces root (FIX-150).

`requestId` and `sessionId` reach the tool from the request body — the action route validates only that they are strings — and the resolved scope id becomes a path segment under `.fsdev/workspaces/`. A traversal-shaped id therefore placed a run's workspace wherever the caller liked. `userId` and `orgId` come from a verified principal, but fall back to the session id when absent, so every scope was exposed (BP-031).

Scope ids are now normalized to a safe directory name. Ordinary ids (`req_x1y2`, `sess_abc`) are already in the safe set and pass through unchanged, so no existing workspace is renamed. Anything else is rewritten and given a digest of the original, so two hostile ids differing only in unsafe characters cannot collapse onto one workspace. Rewritten ids carry an `enc-` prefix that a passed-through id can never have: without the separation an encoding is itself a valid unencoded id, and an attacker who wants a victim's `a/b` workspace computes the digest and submits `a-b-<digest>` as their own id. Pass-through is also length-bounded, since an over-long id is a filename the first write fails on.

**`run` and `session` workspaces are namespaced by tenant.** Their ids arrive on the request body, so two tenants naming the same one shared a live sandbox and a directory of files. The boundary is `tenantId`, which is the framework's own — it already namespaces session storage so two tenants sharing a session id never share data. `user` and `org` are keyed on the identity they are named for and nothing else, because those scopes are shared across tenants by design and a tenant segment would split the sharing they exist to provide. The MOAT provider's default run name follows the same identity, from one definition with two readers: the provider reconnects by run name alone, and the stale-container purge is told which name to spare, so two derivations of it would both attach one principal's projection to another's container and leave the live one eligible for destruction while a request reconnects to it.

**Registry-key components are length-framed.** Joined raw on a delimiter, `(tenant "a:b", request "d")` and `(tenant "a", request "b:d")` spell the same key — and the collision is on the registry rather than the directory, so the second principal is handed the first's live sandbox before a directory of its own exists.

Existing local workspaces under `.fsdev/workspaces/` are not migrated: a run whose path is new starts in a new, empty directory.

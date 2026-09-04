---
"@flow-state-dev/tools": patch
---

A caller-supplied id can no longer put a bash workspace outside the workspaces root (FIX-150).

`requestId` and `sessionId` reach the tool from the request body — the action route validates only that they are strings — and the resolved scope id becomes a path segment under `.fsdev/workspaces/`. A traversal-shaped id therefore placed a run's workspace wherever the caller liked. `userId` and `orgId` come from a verified principal, but fall back to the session id when absent, so every scope was exposed (BP-031).

Scope ids are now normalized to a safe directory name: every id becomes `enc-<readable>-<digest>`, where the digest is a truncated SHA-256 of the exact original. Two ids that differ at all therefore land on different workspaces, including ones differing only in unsafe characters, only in length past what a filename accepts, or only in case on a case-insensitive filesystem (macOS APFS, Windows), where two spellings name one directory while keying two registry entries. There is no pass-through for ordinary-looking ids — keeping those readable meant a second namespace that had to stay disjoint from the encoded one, and the readable half stays in the name anyway for whoever reads `ls`.

**`run` and `session` workspaces are namespaced by tenant.** Their ids arrive on the request body, so two tenants naming the same one shared a live sandbox and a directory of files. The boundary is `tenantId`, which is the framework's own — it already namespaces session storage so two tenants sharing a session id never share data. `user` and `org` are keyed on the identity they are named for and nothing else, because those scopes are shared across tenants by design and a tenant segment would split the sharing they exist to provide. The MOAT provider's default run name follows the same identity, from one definition with two readers: the provider reconnects by run name alone, and the stale-container purge is told which name to spare, so two derivations of it would both attach one principal's projection to another's container and leave the live one eligible for destruction while a request reconnects to it.

**Tenant absence is framed, not spelled.** `-` is a tenant id the engine accepts — `extractTenantId` rejects only the empty string and anything containing `":"` — so a sentinel put "no tenant" and the tenant named `-` on one key and one directory. Presence is its own framed component now, and the directory uses a segment the id encoder cannot emit.

**Registry-key components are length-framed.** Joined raw on a delimiter, `(tenant "a:b", request "d")` and `(tenant "a", request "b:d")` spell the same key — and the collision is on the registry rather than the directory, so the second principal is handed the first's live sandbox before a directory of its own exists.

Existing local workspaces under `.fsdev/workspaces/` are renamed once and not migrated: a run whose path is new starts in a new, empty directory. These hold a run's scratch, not durable state — anything a run is meant to keep goes to its collections.

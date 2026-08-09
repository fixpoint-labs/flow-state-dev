---
"@flow-state-dev/chat-sdk": patch
"@flow-state-dev/cli": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/testing": patch
---

Delete a session and create a new one with the same id, and the new session now
starts on a clean scope even when an action from the deleted session is still
running (FIX-1000). Previously that action could write into the scope after the
delete purged it, and the recreated session read the row back as its own — a create
carries `expectedVersion: 0` ("no live row"), which a never-existed key
satisfies against a purged scope exactly as against a fresh one, so no per-key
predicate could close it.

Each session record is created with an opaque `storageGeneration` nonce, and
session-scoped resource state and content address at
`${sessionKey}#${storageGeneration}` rather than at the session key alone. Two
sessions sharing an id never share an address, so a straggling write still
commits, into an address nothing reads again. `resolveSessionStorageKey` keeps
its meaning — the session *record* key — and the new
`resolveSessionResourceScopeId(record)` is the only producer of a session-scope
resource address. It takes the record because the record is what carries the
generation.

No migration, no backfill, and no store-adapter change: `scopeId` was already an
opaque string in every adapter. Session records persisted without a generation
address the bare scope id exactly as before and keep reading their existing
rows; they pick up the fence when they are next recreated. Custom session stores
should round-trip `SessionRecord` whole — one that projects only the fields it
recognises and drops `storageGeneration` leaves its sessions unfenced.

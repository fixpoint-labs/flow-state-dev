---
"@flow-state-dev/engine": patch
---

On the in-memory backend a `reject` or `queue` request now takes its concurrency place only after the caller's ownership of the session is checked, so another user can no longer briefly hold a session's key, and a `reject` refusal arrives through the dispatch handle's `accepted` rather than as a synchronous throw (FIX-1837).

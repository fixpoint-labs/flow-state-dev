---
"@flow-state-dev/react": patch
---

`useSession` with `autoResume` no longer sits on stale items when the request it was going to attach to finishes while the hook is mounting (FIX-1012).

On mount the hook reads the session snapshot and then, separately, looks for an in-progress request to attach a stream to. A request that finished between those two reads fell through both: there was nothing left to attach to, and the snapshot already applied predated the request's final items. The session stayed incomplete until the consumer remounted or called `refresh()` by hand. It now re-reads the snapshot once in exactly that case, so the last items arrive without any further interaction.

Sessions that were already idle when the hook mounted are unaffected and still read the snapshot once.

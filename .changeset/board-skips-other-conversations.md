---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/store-postgres": patch
---

A task board open for one conversation no longer re-reads when a task is filed in another conversation of the same user (FIX-2750).

- **contracts:** `WireNotice` gains an optional `partition`: on a `board` notice for a row added to a partitioned ledger, an opaque key for the partition the row went into. `ViewHearing` gains an optional `partitions`, the keys of the partitions a view's run read. `hearsNotice` skips a `board` notice whose `partition` the answer didn't read. A notice with no `partition`, or an answer that lists none, hears every board notice, as before.
- **engine:** the push socket and the view route send a partition only as an HMAC-SHA256 key under the router's push secret, over the tenant and the partition. A key names no session and can't be matched by hashing guessed ids. Every process behind one address must share the push secret (`FSD_PUSH_SECRET`, or `serve({ pushSecret })`), which tickets already require. A host with no push names no partition in its answers. When the push secret changes while a socket is open (`secret: () => string`), the socket sends a `resync` on its topics before the first key made under the new secret, so every open view reads again.
- **orchestration:** a partitioned task ledger (`partitionBy`) names its partition on each row-added notice and on each board read, so a conversation board hears only its own conversation's new rows.
- **client:** a `partition` on a socket frame that isn't a string is dropped; the notice is kept.
- **store-postgres:** the Postgres bus carries a notice's partition across processes, and drops it with the ids when the payload is too large.

Docs: apps/docs/docs/api/client.md (the `onChange` notice can carry `partition` on a `board` notice: an opaque key to compare, never a session id)

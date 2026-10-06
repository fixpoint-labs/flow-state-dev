---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

`defineResourceCollection` accepts `ownerWrites: { param }`: every reader the collection's scope serves reads each row, and only the user the row's owner segment names writes it. Key rows with `ownerSegment(userId)` at that parameter, as for `ownerPrivate`, and the same pattern rules apply (the parameter appears once, no `**`); a browser read is allowed. A create, update or delete by anyone else, through the collection handle, a ref obtained by reading, or the browser update and delete routes, throws `A row of an owner-writes collection is written only by the user it belongs to.` and changes nothing. The startup fence covers these collections too: a wider collection in the same scope that can reach their keys, or the same pattern declared `ownerPrivate`, stops the app from starting. A collection can't declare both modes, and an owner-writes collection can't declare an `eviction` policy other than `"none"` (FIX-1793).

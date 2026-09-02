---
"@flow-state-dev/workspace": patch
---

`flush` names the one failure a caller can safely swallow (FIX-150).

A place that cannot be listed makes a flush throw, on purpose: the delete pass reads "absent from the place" as "deleted by the run", so an unreadable directory read as an empty one deletes everything the projection owns. Nothing is decided, nothing is written, and the run's files are still where the run left them — which makes it the one rejection a caller can catch and carry on from.

Every other rejection a flush can produce is the opposite. A collection read, write, or delete that fails means the run's work did not reach the store, and a caller catching both alike reports success for a run whose files went nowhere.

They were indistinguishable. `flush` now wraps a failed `Place.list` in an exported `PlaceUnreadableError` and lets everything else through unchanged, so `catch (err) { if (!(err instanceof PlaceUnreadableError)) throw err }` is a caller's whole recovery.

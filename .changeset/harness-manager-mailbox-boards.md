---
"@flow-state-dev/harness-manager": patch
---

`harnessManager` now runs a board a channel holds. A board id may carry a single dot between its parts (`eng.feature.work`), and the manager uses it as is for each run's checkout folder and branch, so it never shares either with `eng-feature-work`. Board ids that worked before derive exactly the same folders and branches. An id a git branch can't carry, such as one ending in `.lock`, is now refused when the manager is built rather than when a row is claimed.

On a board kept per organization, a row's coding run belongs to the member who started it. Wire the new `runOwnerDispatcher()` on the board that drains the rows, and another member's drain is refused, naming whose run it is, without charging the row an attempt; the starter's own retry continues in the same checkout, branch, run record and agent session (FIX-1667).

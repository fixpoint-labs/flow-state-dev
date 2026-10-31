---
"@flow-state-dev/harness-manager": patch
---

A board id may carry a single dot between its parts (`eng.feature.work`), and the manager uses it as is for each run's checkout folder and branch, so it never shares either with `eng-feature-work` (FIX-1667). Board ids that worked before derive exactly the same folders and branches. An id a git branch can't carry, such as one ending in `.lock`, is now refused when the manager is built rather than when a row is claimed.

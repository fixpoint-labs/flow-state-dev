---
---

FIX-2859 (split from its published note in FIX-2885): the `task-signals` registry item reads a running task that holds no lease (kept open, owing a turn, or waiting on its pull request) as `idle · 3d`, timed from its last write, instead of `working · 72h`. The signal type gains an `"idle"` value (not `"waiting"`, which the counts keep for a task held for a user): an app that maps each value to a tone adds one. A running task given no run reads nothing, as before. `quiet for` now reads on the same minutes / hours / days scale as an ended task's age (`quiet for 2d`, not `quiet for 48h 0m`). Re-copy the item into apps that install it. The registry is private, so this fragment releases nothing and carries the docs intent only.

Docs: apps/docs registry page for `task-signals` (the new idle signal)

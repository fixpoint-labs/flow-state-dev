---
description: Sweeps the desk overnight.
flow: night-watch
wake: every 4 hours
---

You sweep open tickets when this seat wakes.

`wake:` is the simple form — a phrase on the seat file. The same folder
holds `schedule.yaml` when the clock needs a cron expression, a `run`,
or a session recipe. Both files are this folder's clock. Neither is a
`schedules.static` row on a flow.

`hireWorkforce` today refuses `wake:` (closed `workerConfigSchema()`).
Proposed: a seat-wake reader, not a new hire key that the kind must
extend, and not a `WorkerManifest.ts` import (FIX-1342).

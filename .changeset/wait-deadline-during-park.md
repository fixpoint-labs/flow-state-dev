---
"@flow-state-dev/engine": patch
---

A wait whose deadline passes while its request is still parking now resumes at the sweeper's next tick once the park is recorded, rather than about five seconds later. Before, the sweep found the request not yet parked and put the deadline off for its overdue-wait retry, so a `getTask` wait with a short deadline could miss it by seconds when the park's request-end hooks took a while (FIX-2150).

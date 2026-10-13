---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

A worker's `discover:` line now narrows its discovery tool on every worker flow, `coordinator` included, and Shift Manager reads a failed tool call that a later call of the same tool retried as "Tried <tool>", not a failure (FIX-1920).

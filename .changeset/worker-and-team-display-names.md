---
"@flow-state-dev/workforce": minor
---

`WORKER.md` and `TEAM.md` take an optional `name:`, a display name for people (FIX-1959). A team's name rides each of its workers as `teamName`. Both reach the worker inventory rows and the standard workers' roster entries as `name` and `teamName` (`null` when unset). `name` is read by the installation, never handed to a worker flow as a setting.

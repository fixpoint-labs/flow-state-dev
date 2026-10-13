---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

A worker's `discover:` line now narrows its discovery tool on every worker flow, `coordinator` included. Before, a coordinator worker's line was read from the shared flow's settings rather than its own file, so it saw every domain whatever it named. The DevTeam project coordinator names none, so the only workers it reads are the leads `listLeads` returns. In Shift Manager, a failed tool call that a later call of the same tool retried with success reads "Tried <tool>" and no longer marks its run as failed.

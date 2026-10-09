---
"@flow-state-dev/orchestration": minor
---

The task tools' roster type is renamed `WorkerRoster` → `AssigneeRoster`, the name for who a board's tasks can be assigned to. Its shape is unchanged (`has(assignee)`, `describe()`), so updating the import is the whole migration. The new `AssigneeRosterSource` is either a fixed `AssigneeRoster` or a function of the running block's context that is read on each call that checks an assignee, for a board whose team changes while it is in use. `createTaskToolsCapability(resolver, roster?)` and both `taskToolActions` overloads accept it (FIX-1794).

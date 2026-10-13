---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A task's `input` passed to `addTask` or `dispatchTask` as a string of JSON (`'{"project":{...}}'`) is now stored as the object it spells, so a worker's readers find its fields. Before, a task that named its project this way was refused as naming none. When a task's `input` is a non-object and no project is found, the `no-project` refusal now says so, instead of reading as if the task named no project.

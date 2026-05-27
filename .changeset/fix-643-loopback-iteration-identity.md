---
"@flow-state-dev/core": minor
"@flow-state-dev/devtool": patch
---

`loopBack` re-executions now carry a distinct identity per iteration. Steps re-run after a `loopBack` jump receive a `loop[N]` path segment, so their child blocks get a unique `blockInstanceId` each pass (mirroring how `doUntil`/`doWhile` segment their bodies). The first pass is segment-free, so non-looping code and first iterations are unchanged. Patterns that drain a task list through a looping worker — Plan & Execute, supervisor — now produce one identity per task instead of collapsing every task onto one.

The DevTool trace view renders these iterations as distinct rows, each labeled `iter N`, with a compact preview of the input it received and the output it produced. Tool calls cluster under the iteration that issued them, so per-task behavior is readable without untangling a merged list.

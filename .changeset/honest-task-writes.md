---
"@flow-state-dev/orchestration": minor
---

Task writes now report what they actually did, and assigning work to a finished task is refused instead of silently accepted.

Against a task that had already completed, errored, or been cancelled, the delegation task tools gave three different answers and only one was true. `blockTask` refused and explained why. `cancelTask` reported success and did nothing at all. `assignTask` reported success and wrote the new assignee onto a dead task whose work would never run again. A coordinator could not tell from the tool result that nothing had happened — it had to separately re-read the task and notice the status never changed.

`assignTask`, `cancelTask`, and an `updateTask` carrying an `assignee` now answer `{ ok: false, error: "terminal_task_write_declined: …" }` on a finished task, naming its terminal status and what will not change. The message reads the same way `blockTask`'s refusal already did. `updateTask` runs the assignee write first and stops there on a refusal, so a declined patch leaves the priority, metadata, and labels in that same patch unwritten too.

Underneath, `complete`, `fail`, `cancel`, and the five field mutators on `TaskCollectionRef` return a `TaskWriteOutcome` — `recorded`, `unchanged`, or `declined` with a reason (`terminal`, `disallowed`, or `lost-claim`) and the status observed. The verdict is produced inside the same atomic write that made the decision, so it cannot race the write it describes and you never have to re-read the task to find out. A declined write still writes nothing and still never throws; ignoring the return value is supported and behaves exactly as before, which is what keeps a late worker result landing quietly on a settled task without disturbing its siblings.

Labels, priority, and metadata are deliberately still writable on a terminal task — a post-drain audit recording why something failed needs that — so `setAssignee` is the only field mutator that refuses anything.

**Source-breaking for custom `TaskCollectionRef` implementations.** Those eight methods previously declared `Promise<void>`, so a TypeScript implementation returning nothing no longer satisfies the interface. Return the outcome, or wrap your ref in an adapter that derives one. A ref that reports nothing keeps working at runtime: a missing verdict is treated as "nothing was determined", never as evidence the write happened. `ok: true` from these tools means the backing reported no decline, not that the write landed.

---
"@flow-state-dev/harness-manager": minor
---

`harnessMessageDoor({ boards })` builds the message door for a flow whose coding runs come from more than one board, such as a manager that reads its board from the claim, or two managers on one flow. The host names the boards the calling session's run may be on, each with its drain and, for tasks with no `{ issue, phase }` payload, how its runs are keyed. It behaves the same as `manager.messageDoor`, which is unchanged. The door's input and output schemas, `TurnRefused`, and the door's types are now exported too (FIX-1866).

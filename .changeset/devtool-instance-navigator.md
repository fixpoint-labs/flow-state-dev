---
"@flow-state-dev/devtool": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

The DevTool identifies flows by instance, not by kind (FIX-1324). Every registered copy is its own navigator row labelled with its exact ID, and selecting one selects its sessions and requests: switching between two copies of a kind shows each one's own work, and the controls on screen — action dispatch, live stream, replay, Continue, suspension approve/reject — are addressed to the copy that is selected. A saved session is offered back only after the server confirms it belongs to that copy, so a stale selection opens an empty workspace instead of a peer's conversation. Opening a child session created by work dispatched into another instance moves to that instance, and the breadcrumb returns to the one it came from. Single-copy apps are unchanged.

`SuspensionRecord` gains an optional `flowId` naming the instance that suspended, so a resume re-enters the copy that is waiting. Records written before this field carry only `flowKind`; read it as `record.flowId ?? record.flowKind`.

---
"@flow-state-dev/workforce": patch
---

A lead's `updateWorkstream` tool (`updateWorkstreamTool`) no longer takes `title`, so a worker leading several workstreams can't write one's name onto another: `updateOwnWorkstreamInputSchema` is status, due date, objectives and report. A call with `title` fails validation. A workstream is renamed by its owner through `updateWorkstream`, or by their project coordinator's `editWorkstream` (FIX-1968).

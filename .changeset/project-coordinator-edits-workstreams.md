---
"@flow-state-dev/workforce": minor
---

`defineWorkstreamBlocks()` adds `editWorkstreamTool`, a tool named `editWorkstream` for a project coordinator: it changes one of the caller's own workstreams by id (title, status, due date, objectives) in the project its conversation belongs to. Naming another project is refused (`other-project`), and an id the caller has no workstream under is refused (`no-such-workstream`). Marking one done takes its delegate off the coordinator in the same turn. `editWorkstreamInputSchema` is exported (FIX-1963).

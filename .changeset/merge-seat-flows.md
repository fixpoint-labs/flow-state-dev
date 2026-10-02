---
"@flow-state-dev/workforce": minor
---

`mergeSeatFlows(flows, seats)` adds hired seats to an app's flows record and throws, naming the id, when a seat's id is already a flow's (an org worker folder named `channel`, say) instead of letting the seat replace that flow. `newIncarnation()` and `tagIncarnation(seat, incarnation)` are exported for a host that writes roster rows itself, so its hires carry an incarnation a fire can tell from a replacement's (FIX-1719).

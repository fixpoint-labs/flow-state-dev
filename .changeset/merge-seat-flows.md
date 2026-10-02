---
"@flow-state-dev/workforce": minor
---

`mergeSeatFlows(flows, seats)` adds hired seats to an app's flows record and throws, naming the id, when a seat's id is already a flow's (an org worker folder named `channel`, say) instead of letting the seat replace that flow (FIX-1719).

---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

A wait that dies after starting its work and before it parks is continued (FIX-2269). `dispatcher({ wait: true })` and a worker's call (`sendMessage({ wait: true })`) now owe their park through the new optional `RequestWaits.owingPark(work)` before they dispatch or send. If the request is then marked `interrupted` while it still owes one, the durability sweeper continues it, and the replay parks on the work it already started, so the call is answered instead of left waiting forever. A request still owing its park 10 minutes after the first owe is left `interrupted`. History and retention read an interrupted request that owes a park as one that will run again, and stopping it lets the owe go. A repeated call's send now dispatches itself, so the continued call has a request to wait on.

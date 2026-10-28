---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

A worker's call that dies after sending its message and before it parks is continued (FIX-2269). A call (`sendMessage({ wait: true })`) now owes its park through the new optional `RequestWaits.owingPark(work)` before it sends. If the request is then marked `interrupted` while it still owes one, the durability sweeper continues it, and the replay waits on the message it already sent, so the call is answered instead of left waiting forever. A request still owing its park 10 minutes after the first owe is left `interrupted`. History and retention read an interrupted request that owes a park as one that will run again, and stopping it lets the owe go. A repeated call's send now dispatches itself, so the continued call has a request to wait on.

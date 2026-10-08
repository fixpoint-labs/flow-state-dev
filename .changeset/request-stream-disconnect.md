---
"@flow-state-dev/engine": patch
---

A live request stream (`GET …/requests/:id/stream`) now ends as soon as its caller disconnects on Node hosts that report a disconnect only through the request's signal. Before, it could keep its store subscription open until the live-tail liveness timeout (FIX-1617).

---
"@flow-state-dev/client": minor
---

Add `createRequestStreamStore` and `bindStoreToCallbacks` — a headless accumulator that folds a request's SSE events into a sorted, canonical item list (with streaming text accumulation, request status, and a resume cursor), so non-React consumers can share one tested reducer instead of writing their own.

---
"@flow-state-dev/engine": patch
---

`writeContent` now always writes to the content store. Previously a write whose body matched what the request had last read or written was skipped, so if another writer had changed the content in between, the later write was silently dropped while still resolving successfully (FIX-1274).

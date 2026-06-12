---
"@flow-state-dev/server": patch
---

Fix distinct-key resource-collection writes from concurrent `.parallel` / `.forEach` branches clobbering each other in the in-memory scope cache. Single-key resource and collection-instance writes now commit per key and update the live per-scope cache in place instead of replacing the whole map, so a convergence read (`list()`/`count()`) after a parallel fan-out sees every instance, not just the last branch's. Same-key concurrent writes remain last-writer-wins.

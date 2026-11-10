---
"@flow-state-dev/engine": patch
---

A long-running server on Node 22 no longer grows and slows with every request it runs (FIX-2643). Each request made two `AsyncLocalStorage` instances; on Node 22 a used one stays in a process-wide list for good, and every later `await` in the process walks that list. A server that had run a few thousand requests spent seconds on work that took milliseconds at start. Requests now share one storage per process. Nothing to change in your code.

Docs: none (no public surface changes).

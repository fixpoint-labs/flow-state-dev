---
"@flow-state-dev/testing": patch
---

Add `findNodeBuiltinsFromEntry` and `findImportsFromEntry`, which walk a source entry's import graph and report every Node built-in (or any import you name) it reaches with the chain that reached it, for guarding browser-safe entry points (FIX-1605).

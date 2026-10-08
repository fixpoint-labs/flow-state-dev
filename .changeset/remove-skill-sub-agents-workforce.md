---
"@flow-state-dev/workforce": minor
---

A worker no longer gets `runBoard` and a private board's task tools from a skill it holds, because skills can no longer declare `agents:`; a worker skill that still does is reported in `skillErrors` when the tree is read (FIX-1814).

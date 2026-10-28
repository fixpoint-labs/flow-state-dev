---
"@flow-state-dev/cursor": patch
---

Join the chunks Cursor streams an answer and its thinking in into one message and one reasoning item, instead of one item per chunk. A run's `finalMessage` is now the whole answer, not its last chunk.

---
"@flow-state-dev/devtool": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

The debug resource snapshot now reports each resource's `writable` and `llmWritable` settings where they are declared, and the DevTool marks a resource read-only when `writable` is `false` (FIX-1481).

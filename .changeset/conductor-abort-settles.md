---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

A cancelled request keeps resource writes open until the foreground chain — including a `.rescue()` handler — returns, so a cancelled worker can settle its row instead of leaving it in progress. (LAB-151)

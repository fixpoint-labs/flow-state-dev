---
"@flow-state-dev/core": patch
---

FIX-2321: An async `onActivity` hook that rejects is now logged like one that throws, instead of escaping as an unhandled rejection that could end the process.

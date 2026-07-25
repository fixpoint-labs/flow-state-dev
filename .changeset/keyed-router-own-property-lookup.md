---
"@flow-state-dev/core": patch
---

`utility.keyedRouter` now resolves routes from own properties only, so a selected key naming an inherited `Object.prototype` member (`toString`, `constructor`, `__proto__`, …) takes the `fallback` or raises the registered-key error instead of dispatching a non-block.

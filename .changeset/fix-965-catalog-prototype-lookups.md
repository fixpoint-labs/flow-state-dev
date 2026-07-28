---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

Fix catalog and task lookups so a prototype-named key (`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`) is treated as a miss instead of resolving to an inherited `Object.prototype` member. An agent's `tools:` / `usesCapabilities` entry naming a prototype member now warns and is skipped like any other unknown key rather than smuggling a non-tool into the generator's `tools` / `uses` slot, and a task id naming one takes the usual "not found" path instead of crashing or reporting a false duplicate.

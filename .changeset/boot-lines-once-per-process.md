---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

Boot diagnostics print once per server process instead of once per hot reload under `next dev`: the unattended-board warning from `hireWorkforce`, the `[flowstate] active profile` line, and `warnOnceDev` messages such as intent overrides. A board that newly goes unattended still warns. New `firstInProcess(key)` helper in `@flow-state-dev/core` returns `true` the first time a key is claimed in the process, and survives module re-evaluation (FIX-1632).

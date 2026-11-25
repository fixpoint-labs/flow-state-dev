---
"@flow-state-dev/core": patch
---

A block that declares sequencer targets under computed names now gets the declared state type from `ctx.targets`. Generic `BlockContext` readers continue to accept typed blocks. (FIX-2457)

---
"@flow-state-dev/workforce": patch
---

`openInventory` fills the live workforce inventory at boot: one row per hired seat, and one per open channel written by that channel itself from its own session state. `channelInstances({ inventory: true })` builds the built-in channel kind carrying the writer, and `inventoryWriterActions(kind)` puts the same two actions on a hand-rolled channel kind (FIX-1405).

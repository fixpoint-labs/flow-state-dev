---
"@flow-state-dev/workforce": patch
---

A built-in agent worker's turn now defaults to 50 model steps instead of core's generator default of 8, so a worker can read several files or make several lookups before it answers. A worker that keeps calling tools can now spend up to 50 model calls per turn. Set `maxSteps: 8` on the flow options to keep the old cap (FIX-2491).

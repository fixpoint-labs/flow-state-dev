---
"@flow-state-dev/orchestration": patch
---

A failure's or a cancel's notice names every dependent its ending cancelled, as the docs say, also when another request filed the dependent after the failing worker's run had read the board. `onTaskSettled` cancels such a dependent before it runs your block and adds it to the notice's `cancelled`. Before, the notice named none, and the dependent was cancelled later with no notice of its own, so the filer never heard of it (FIX-2136).

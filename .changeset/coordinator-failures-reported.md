---
"@flow-state-dev/workforce": patch
---

Coordinator failures now reach the Error Reporter (FIX-2010). A delegate's post that ends errored sends its report as the post ends, not on the coordinator board's next touch. A best-fit coordinator's crashed turn, answered with "Nobody took this post", is reported too, although its request completes.

---
"@flow-state-dev/testing": minor
---

`testBlock` now returns `resources` — the block's resolved resource registry after the run, keyed by the accessor names in `declaredResources`. A test asserting on rows a block wrote no longer has to build its own context and invoke the block's `execute` callback by hand, which skipped the execution wrapping consumers go through. `testSequencer` and `testRouter` carry the field too (LAB-138).

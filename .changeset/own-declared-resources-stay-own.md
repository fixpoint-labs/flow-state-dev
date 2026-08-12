---
"@flow-state-dev/core": patch
---

Fix a block built with `uses:` absorbing its children's resources into its own
declarations when something is composed onto it — a sequencer's `.step()`, or a
`.rescue()` on a handler or generator. The effect was visible on
`prefetchMode: 'lazy'` resources: one declared by a child now loads when that
child dispatches, rather than early at the parent's dispatch and even when the
branch holding that child never runs. Blocks that declare no capability
resources were never affected (FIX-1052, FIX-1051).

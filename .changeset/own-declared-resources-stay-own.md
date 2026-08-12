---
"@flow-state-dev/core": patch
---

Keep a block's `ownDeclaredResources` fixed to its own declarations. Composing
onto an already-built block could reach back and rewrite what that block had
already published: `mergeDeclaredResources` wrote into the object it was handed,
and a block that carries capability-contributed resources passes one reference
as both its own declarations and the accumulator that child resources bubble
into. A sequencer built with `uses:` grew its first `.step()` child's resources
into its own set; on a handler or generator, whose own set *is* its bubble-up
set, a single `.rescue()` rewrote both retroactively. The block-dispatch
prefetch hook reads `ownDeclaredResources` specifically to load a block's own
declarations without re-loading a descendant's, so the effect was a superset of
what should have been loaded, at the parent's dispatch rather than the child's.

`mergeDeclaredResources` now returns a fresh object on every path and never
writes into either argument. Blocks with no capability-contributed resources
were never affected — the shared reference is `undefined` in that case, and
merging into `undefined` already copied, which is why the common composition
looked correct.

Also closes FIX-1051, which is the same defect reached through `.rescue()`
swapping a handler on a sequencer chain.

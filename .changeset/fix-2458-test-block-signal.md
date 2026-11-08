---
"@flow-state-dev/testing": minor
---

`testBlock` takes a `signal` (FIX-2458).

- **testing:** `testBlock(block, { input, signal })` runs the block under your `AbortSignal` as `ctx.signal`. Abort it to stop the run the way a host does, with a deadline or a user's stop, and check what the block does with it. `createTestContext({ signal })` takes it too. Without `signal`, the block runs as before, under a signal that never fires.

Docs: packages/testing/README.md (`signal` in `testBlock`'s options, with a short example that stops a run mid-way and reads the error)

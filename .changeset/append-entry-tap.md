---
"@flow-state-dev/patterns": minor
---

**Breaking (`@flow-state-dev/patterns`):** the block that `createAppendEntry` returns no longer echoes the entry back as its output. It writes the workspace resource and emits its `rb-entry` component, and produces nothing (FIX-1227).

Flow authors who remix the `eventActors` emit pipeline must compose it with `.tap()` instead of `.step()`:

```ts
sequencer({ name: "my-emit", inputSchema: entrySchema })
  .tap(createAppendEntry("my-emit", rb.workspace))   // entry is recorded, the entry flows on
  .step(myCustomDispatch)
```

As a `.step()` it now hands `undefined` to the next step. The pattern's own `emit` sequencer already composed it as a tap, so `eventActors(...)` itself is unchanged. This finishes the state-only-step cleanup that already covered `captureContext` and the internal `eventActors` steps.

# Example: Kitchen Sink

This example is the full reference flow for canonical Phase 1 patterns.

It demonstrates:

- `defineFlow` with `session` and `user` scope state
- all block kinds: `handler`, `generator`, `router`, `sequencer`
- router decisions from both action input and `ctx.session.state`
- generator tool loop with handler-backed tools
- generator slots: `prompt`, `context`, `history`, `user`
- `clientOutput` and `llmOutput` transforms
- `renderKey`-based block renderer resolution
- sequencer DSL coverage: `.then()`, `.thenIf()`, `.map()`, `.parallel()`, `.tap()`, `.rescue()`
- session resources (`artifacts`) with resource reads/writes
- client projections on `session` and `user`
- action-level lifecycle handling via `onCompleted`
- React usage with `FlowProvider`, `useBlockContext`, `useProjections`, and `ItemsRenderer`
- testing coverage with `testFlow`, `testBlock`, `testRouter`, seeded state/resources, and item assertions

Run verification:

```bash
pnpm --filter @flow-state-dev/example-kitchen-sink typecheck
pnpm --filter @flow-state-dev/example-kitchen-sink test
```

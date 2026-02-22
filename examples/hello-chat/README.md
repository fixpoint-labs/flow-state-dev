# Example: Hello Chat

This example demonstrates the minimal chat flow shape:

- `defineFlow` with explicit `session.stateSchema` and a client projection
- one generator-backed action (`chat`)
- pure `clientOutput` and `llmOutput` transforms
- session state mutation via `ctx.session.patchState`
- React usage with `FlowProvider`, `useSession`, `useProjections`, and `ItemsRenderer`
- deterministic flow tests with `testFlow`

Run verification:

```bash
pnpm --filter @flow-state-dev/example-hello-chat typecheck
pnpm --filter @flow-state-dev/example-hello-chat test
```

# Example: Hello Chat

This example demonstrates the minimal chat flow shape:

- `defineFlow` with explicit `session.stateSchema` and a client projection
- one generator-backed action (`chat`)
- emission API: silent-by-default blocks, explicit `ctx.emitMessage()` / `ctx.emitStatus()`
- session state mutation via `ctx.session.patchState`
- React usage with `FlowProvider`, `useSession`, `useProjections`, and `ItemsRenderer`
- deterministic flow tests with `testFlow`

Run verification:

```bash
pnpm --filter @flow-state-dev/example-hello-chat typecheck
pnpm --filter @flow-state-dev/example-hello-chat test
```

## Testing note

The hello-chat tests intentionally mock generator responses and fail fast on any
network access. This keeps the suite deterministic in CI and ensures no
`OPENAI_API_KEY` is required for test runs.

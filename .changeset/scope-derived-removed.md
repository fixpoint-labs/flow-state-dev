---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/react": patch
---

A scope's `client.derived` is removed; a value computed for a screen is a view (FIX-2623).

- **core, breaking:** `ScopeClientConfig` has only `expose`. `defineFlow` refuses a `derived` key on `session.client`, `user.client` or `org.client` with an error naming views, rather than defining the flow and sending nothing. `ClientDataComputeFn` and `ClientDataContext` are removed from `@flow-state-dev/core/types`, with no alias. To move a derived value, declare it as a view: `views: { modeStatus: defineView({ scope: "session", block }) }`, where `block` reads `ctx.session.state` (or `ctx.user`, `ctx.org`, or resources) and declares its `outputSchema`, and read it with `useView(viewRef<typeof modeStatus>(flow, "modeStatus"), {}, { sessionId })` or `client.view`. A value that only copies a state field can stay client data with `expose: ["field"]`.
- **core:** a view whose answer is one object, not a list, is now a flow's `views` entry with no cast in strict TypeScript. Its `key` was typed as a function over `never`, which `strictFunctionTypes` refused.
- **engine:** the session state route returns only `expose`d fields as client data. A resource write publishes on its scope's topic when the resource has a `client` config, or when any flow on the host declares a view.
- **react:** a live session view no longer re-reads state on every resource change of a scope that has client data. Client data is exposed state, which a resource change can't move.

Docs: apps/docs pages on scope client data (`derived` retires; `expose` stays; computed values point at Views), packages/core/README.md (the `client` config and its example), packages/engine/README.md (what publishes on a scope's topic), packages/react/README.md (`useClientData` without `client.derived` values).

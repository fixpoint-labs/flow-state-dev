---
"@flow-state-dev/core": minor
---

Surface the framework's block + context types on the public barrel:

- `BlockDefinition` — fully-typed return interface of `handler()`, `generator()`, `sequencer()`, and `router()`. Generics default to `ZodTypeAny`, so unparameterized `BlockDefinition` is the unconstrained "any block" form.
- `BlockKind` — `"handler" | "generator" | "sequencer" | "router"` discriminant union.
- `BlockContext` — full block-context interface (the type of `ctx` in `execute`).
- `BlockResult` — handler `execute` return-value union.
- `SessionScopeHandle`, `UserScopeHandle`, `OrgScopeHandle`, `RequestScopeHandle` — the scope handles `ctx.session` / `ctx.user` / etc. resolve to. Each is generic over its state type and includes typed `state` plus the `ScopeStateOps` write helpers (`patchState`, `setState`, `setStateRecord`, …).
- `ScopeStateOps` — the shared state-mutation interface every scope handle exposes.

These were all already returned by the framework's block constructors; they're now importable for app-level factories that accept or return blocks, or that need to type a ctx slice (e.g. `(input, ctx: { session: SessionScopeHandle<MySessionState> }) => …`) instead of hand-rolling a structural shape.

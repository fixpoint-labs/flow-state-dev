---
"@flow-state-dev/core": minor
---

Two additions to support cleaner app-level factory patterns:

- **`LooseBlockContext<TSessionState>`** — permissive ctx alias for helper
  functions that take a block's `ctx` as a parameter. Typed where it
  matters (session scope), permissive on resources to sidestep the
  `BlockContext` `TResources` variance trap. Use when a helper only
  touches `ctx.session` and wants to accept any block's narrower inferred
  ctx without a cast.

- **`handler.withDefaults({...})`** — partially-applied `handler()`
  constructor. Bakes in common config (state schemas, declared resources,
  output schema, capability list) so a family of sibling handlers can
  share scaffolding without restating it per call. Per-call overrides
  win — e.g. a default of `outputSchema: z.void()` can be replaced by
  passing `outputSchema:` explicitly. Together with `LooseBlockContext`,
  this is the framework's answer to "how do I share config across N
  handlers without writing a factory that takes the body as a callback"
  — the no-callback shape avoids the generic-plumbing tax that
  callback-style factories pay.

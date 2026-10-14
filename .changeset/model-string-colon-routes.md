---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

**Breaking:** model strings name a route with a colon, the way AI SDK's provider registry does: `vercel:anthropic/claude-sonnet-5`, `openai:gpt-5.4`, or a key of `providers` such as `triage:native`, for generators and evaluators alike. The `gateway/provider/model` form is removed with no compatibility window: it throws an error naming its colon spelling, when the resolver is built for `defaultModel`, intent lists and `FSDEV_*` overrides, and on first resolve for a block's string or stored data. Rename each one by turning its first slash into a colon. `provider/model` and `intent/<name>` are unchanged.

A `name:model` string is pinned to its route and never falls back to a gateway. `createModelResolver` throws when a name is a key of both `providers` and `gateways`, or when a `providers` key is `vercel` or `openrouter`.

**Type change:** `ParsedModelString` (exported from `@flow-state-dev/core` and `@flow-state-dev/engine`) gains the `"alias"` kind (`{ type: "alias", alias, modelId }`) and loses the `"gateway"` kind and its `gateway` field; `parseModelString` never returns a `provider` for a colon string. Code that switches over `type` exhaustively, or reads `gateway`, must be updated. `ModelResolver` gains an optional `providerOf(modelId)`, which `createModelResolver` implements (FIX-1495).

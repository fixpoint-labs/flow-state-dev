---
"@flow-state-dev/core": minor
"@flow-state-dev/workforce": patch
---

A flow entry can be its block alone, and an action's description falls back to its block's (FIX-2635).

- **core:** `actions: { chat, summarize }` works, with the same client input typing as `{ block: chat }`. The shorthand also works in `reads`, in `internal.actions` and `task.actions`, and in an instance's `actions` override. Use the object form when the entry sets anything else (`userMessage`, `mcp`, `concurrency`, hooks, a token budget). Webhook bindings and schedules keep the object form, since they always carry `input` or `cron`.
- **core:** `inputSchema` on an entry is optional and defaults to the block's own. Set it only when the action's input really differs from the block's: a narrower public contract, an escape hatch such as `z.unknown()`, or richer MCP `.describe()` text.
- **core:** an action's or read's `description` defaults to its block's `description`. An MCP-exposed action now passes validation when its block has a description and the action sets none; it still fails when neither has one. An action's own description still wins, which is the place for wording written for a public MCP tool.
- **core:** new types `ActionEntry`, `ReadEntry` and `NormalizedActions`. `defineFlow` publishes every entry in the object form, so code reading `flow.actions.x.block` is unchanged.
- **workforce:** `defineWorkerRosterFlow` takes bare blocks in its `actions` map too.

Docs: apps/docs/docs/fundamentals/actions.md (the action example writes bare blocks; `inputSchema` is described as an optional override that defaults to the block's, with when to set it; `description` defaults to the block's, and an MCP tool may still want its own), apps/docs/docs/server/mcp.md (an action's description falls back to its block's), apps/docs/docs/configuration/flow.md (the `actions` entry shape), packages/core/README.md (the `defineFlow` example and action reference show `{ inputSchema, block }`)

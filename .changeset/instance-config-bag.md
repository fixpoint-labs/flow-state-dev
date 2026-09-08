---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/testing": patch
---

Two registered copies of one flow definition can now be set up differently (FIX-1331). `defineFlow({ configSchema })` declares what a copy may be created with; the factory call takes `config`, parses it against that schema and freezes it, and every block in that copy reads it as `ctx.flow.config`. Settings are fixed at creation and never persisted, never on the flow listing, and no part of any storage key — anything a copy would write belongs in instance-isolated state instead.

A block declares what it needs of whatever flow installs it with `flowConfigSchema`, on all four block kinds. The declaration types `ctx.flow.config` and makes the flow refuse when it cannot supply it: where the flow is defined when the flow declares no `configSchema` at all, and where a copy is created when the bag does not satisfy the block, naming the flow, the id and the block. Because the check parses the real bag, the guarantee is per copy rather than per definition: a flow looser than a block needs is refused at each mint that omits the field, not where the two were written.

`configSchema` must be a plain `z.object({ ... })`, and is closed before parsing, so a key nobody declared throws instead of being silently dropped. It is definition-only, like `cardinality`: passing it to the factory call throws by name. Flows that declare neither option are unchanged and read a frozen empty object. `FlowInstance` gains `config`; `FlowType` gains `config` and `requiresConfig`, and registering a definition that requires a config bag in place of an instance is refused. `@flow-state-dev/testing`'s block harnesses take `flowConfig`, and their synthetic flow carries the same frozen empty object production does.

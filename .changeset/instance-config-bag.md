---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/testing": patch
---

Two registered copies of one flow definition can be set up differently: `defineFlow({ configSchema })` declares what a copy may carry, the factory call takes `config`, and blocks read it as `ctx.flow.config` (FIX-1331).

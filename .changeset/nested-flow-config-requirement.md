---
"@flow-state-dev/core": patch
---

A block whose `flowConfigSchema` asks for a setting inside a nested object is no longer refused by every flow (FIX-1336). Such a requirement parses to a smaller nested object than the flow's config bag, because Zod strips undeclared keys at every level, and that narrowing was being read as the block contributing a value rather than reading one — leaving the flow unable to be minted or registered. A block-side `.default()`, transform, or coercion is still refused, at any depth.

A generator's check on dynamically resolved tools now descends into each tool the same way the definition-time walk does, so a block that declares a requirement from inside a tool (a sequencer, a router) is refused whether the tool is declared statically or returned by a function.

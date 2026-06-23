---
"@flow-state-dev/core": minor
---

Remove the unused `utility.composer` and `utility.synthesizer` generator factories (and their `*OutputSchema` / `*Config` exports). Neither had any consumer; coordination patterns write their own synthesizers because synthesis prompts and input projections are inherently domain-specific. Use `generator()` directly for bespoke synthesis, or `utility.combiner()` for deterministic artifact merging.

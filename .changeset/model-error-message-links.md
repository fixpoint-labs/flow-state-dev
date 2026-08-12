---
"@flow-state-dev/core": patch
---

Point the two model-configuration migration errors at the published docs
(FIX-939). The `preset/*` removal error and the `selectModel` `prefer` removal
error both ended with an internal tracker reference, one of them a URL that
resolved to nothing. Both now link to the models reference.

The `preset/*` error also dropped a trailing line describing a reasoning-level
setting that does not exist. Migrating from `preset/thinking-*` means choosing an
intent and then setting the provider's own reasoning option through
`providerOptions`.

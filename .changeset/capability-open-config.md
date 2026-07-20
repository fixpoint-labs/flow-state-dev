---
"@flow-state-dev/core": minor
---

Capabilities can now accept typed open configuration. `defineCapability({ config: { schema?, resolve } })` declares a config value and a resolver that maps it onto a block surface, and consumers pass it with `.config(value)` — a first-class alternative to a bespoke `createXCapability(options)` factory. `.config()` composes with `.presets()` in either order, the resolver sees which presets are active so it owns override-vs-add semantics, and validation, block-kind compatibility, and diamond dedup all work as they do for presets (using the same capability twice with conflicting config throws). The `.config()` argument is typed as the schema input; the resolver receives the parsed output. Config on a capability returned from a dynamic `uses` resolver is rejected at request time.

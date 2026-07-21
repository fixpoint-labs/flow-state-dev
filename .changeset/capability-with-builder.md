---
"@flow-state-dev/core": minor
---

Add `.with()` to the capability builder — a normalized consumer surface that collapses `.config()` and `.presets()` into one flat call. `skills.with({ allowed: ["research"], dynamicActivation: true })` is exactly `skills.config({ allowed: ["research"] }).presets({ dynamicActivation: true })`: preset-named keys become preset overrides, the rest become the config value. `.config()` and `.presets()` remain the underlying primitives (capability setup); `.with()` is the one verb consumers reach for.

Config-less capabilities accept preset overrides alone, presets-less accept the config value alone (scalar/array config routed wholesale), and a preset name that collides with a config field is a definition-time error so the bag split stays unambiguous.

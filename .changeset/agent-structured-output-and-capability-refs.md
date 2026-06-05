---
"@flow-state-dev/core": patch
"@flow-state-dev/workforce": patch
---

Close two FIX-702 Agent-primitive gaps so structured-output, preset-parameterized participants can be registry Agents:

- **`Agent.outputSchema`** — an Agent can now declare a structured output contract. `materializeAgent` honors it for the **standalone** shape (the generator emits the typed shape, subject to the same OpenAI-strict requirement as any generator output); **workers** still emit `z.string()`, since the skills pattern machinery builds follow-on actions from text.
- **Capability references in `usesCapabilities`** — `usesCapabilities` now accepts a string key (resolved against the `capabilityCatalog`, as before) **or** a capability reference used as-is, including a `someCapability.presets({ ... })`-configured capability. This keeps full preset typing, mirroring how `generator({ uses })` already consumes capabilities.

Both changes are purely additive — existing string-key, string-output Agents materialize identically.

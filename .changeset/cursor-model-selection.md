---
"@flow-state-dev/cursor": minor
---

`cursorAgent`'s `model` option can name a model's settings, not only its id: a fixed `{ id, params }`, or a resolver that returns one per run. Before, a model with settings (a Grok's effort) could only be set once for every run through `agent.model`.

---
"@flow-state-dev/workforce": minor
---

A worker can hire onto the user's roster from its conversation. The workforce kit adds a `hireWorkers` capability, offered only to a worker whose file picks it (`capabilities: { hireWorkers: [tool] }`). Its tool, `hireWorker`, takes an id, a one-line description, instructions, a provider and model id, and optional tool names, and writes through the roster flow's `hire`, the same write the client's `hire` makes, so the new worker is on the roster at once.

- Before anything is written, the user approves the exact hire (a `user_approval` naming the id, model and tools). Rejecting writes nothing. A server without durable execution refuses the hire.
- Refused before asking, with the reason: an id a standard worker or a roster row already holds, a model not in the kit's `hire.models` list, a listed model with no key or gateway set (the reason names the environment variable, never a value), tool names the worker flow doesn't know, and any field that looks like an API key.
- The kit's new `hire` config: `models` (the model strings a hire may run on; default the agent flow's model) and `tools` (the tools a hire gets when it names none; default none).

Docs: packages/workforce/README.md (the kit's capabilities and its `hire` config).

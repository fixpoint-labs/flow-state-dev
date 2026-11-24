---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
---

- **workforce:** a worker whose file picks `capabilities: { hireWorkers: [tool] }` can hire onto the user's roster with `hireWorker`, through the same roster `hire` that `WorkforceClient.hire` calls. It runs only on a turn the user's own message started. A taken id, a model outside the kit's new `hire.models` (default: the agent flow's model) or without a key, unknown tools, and key-shaped input are refused before anything is asked. The user then approves the whole hire, instructions included. `hire.tools` sets the tools a hire gets when it names none.
- **core:** `containsSecret(text)` says whether text carries a credential, by the same shapes core redacts from error messages, which now include NVIDIA's `nvapi-` keys.

Docs: packages/workforce/README.md (the kit's capabilities and its `hire` config).

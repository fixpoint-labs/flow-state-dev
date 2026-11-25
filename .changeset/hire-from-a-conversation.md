---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
"@flow-state-dev/shift-manager": minor
---

FIX-2840.

- **workforce:** `hireWorkersCapability(installation, checks?)`, capability `hireWorkers`, gives a worker `hire` and `fire`: the roster's own hire and fire, the same writes `WorkforceClient.hire` and `fire` make, taking the same input (`id`, `flow`, `settings`, …). Both run only on a turn the user's own message started. A hire lands at once; a fire waits for the user's approval. Anything the write would refuse is refused first, with the reason. The workforce kit adds it to the flows it builds; a worker gets it by picking `capabilities: { hireWorkers: [tools] }` or by naming `hire`/`fire` in its `tools:` line.
- **workforce:** the roster's hire and edit now refuse a value shaped like an API key, and the kit's new `hire: { models }` config refuses a `settings.model` outside that list or with no key or gateway in the server's environment, on the Hire form and from a conversation alike. Omitted, any model the flow takes.
- **core:** `containsSecret(text)` says whether text carries a credential, by the same shapes core redacts from error messages, which now include NVIDIA's `nvapi-` keys.
- **shift-manager:** the Shift Coordinator's `hire` and `fire` are workforce's `hireWorkersCapability`; `shiftCoordinatorRosterTools` is gone, with no alias. A hire still lands at once and a fire still waits for the user's Approve in Inbox; both now run only on a turn the user's own message started.

Docs: packages/workforce/README.md (the kit's capabilities and its `hire` config) and packages/core/README.md (`containsSecret`).

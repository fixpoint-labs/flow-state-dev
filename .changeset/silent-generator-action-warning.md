---
"@flow-state-dev/core": patch
---

Building a flow now warns, once and in dev only, when a caller action's block is a generator with no `itemVisibility` (FIX-2452). Such a generator emits no items, so a chat mounted on the action renders nothing. The warning names the flow, the action and both fixes: `itemVisibility: { client: true, history: true }` to show the reply in chat, or `itemVisibility: { client: false, history: false }` to stay headless on purpose. Internal, task, webhook and schedule entries are not warned, nor is anything under `NODE_ENV=production` or `FSD_QUIET_WARNINGS=1`.

Docs: FIX-2452. `configuration/blocks.md`, beside its `itemVisibility` table: the warning, when it fires, and the two fixes.

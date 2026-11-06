---
"@flow-state-dev/react": minor
---

`useSuspensions({ reasons })` throws on `human_approval` or `human_input`, naming `user_approval` or `user_input`, and a `user_*` filter also matches a stop core 0.2.0 stored under the old reason; `suspensionShape` reads a stored `human_input` stop as input (FIX-2454).

Docs: none

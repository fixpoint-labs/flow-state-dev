---
"@flow-state-dev/core": minor
"@flow-state-dev/chat-sdk": minor
"@flow-state-dev/devtool": patch
---

Flows can now declare chat event subscriptions directly on the flow definition. Add `chat: { on: { ... } }` to a flow and inbound chat events route to its actions — no adapter-side routing config. Subscriptions support per-event input mapping, optional session-id derivation, and a synchronous predicate; bindings are validated against the flow's own actions at registration.

`@flow-state-dev/core` exposes the new `ChatConfig` and `ChatEventBinding` types and `validateChatConfig`. `@flow-state-dev/chat-sdk` discovers subscriptions from the registry at mount, broadcasts each event to every matching flow, and adds `defineChatBinding<T>()` for typed event handlers; the existing adapter-mount `route()`/`flowKind` keep working as a fallback. DevTool labels chat-sourced requests and surfaces which subscription matched.

---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/devtool": minor
---

The chat transport is removed (FIX-1330): `@flow-state-dev/chat-sdk` no longer exists, `defineFlow` refuses a `chat` option by name instead of accepting `chat.on` bindings, `ChatConfig` / `ChatEventBinding` / `validateChatConfig` are gone from core, `"chat"` is no longer a `DispatchType` or a public re-entry source in the engine, and the DevTool no longer renders a Chat provenance badge. Conversational bots are driven through a caller-addressed action in `actions`; platform events ride the webhook transport.

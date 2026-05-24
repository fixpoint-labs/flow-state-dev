# @flow-state-dev/chat-sdk

## 0.1.0

Initial release. `createChatTransportAdapter` wraps a Vercel `chat`
instance as an FSD inbound transport. Exposes `chatCapability` and the
`chat.post` / `chat.typing` / `chat.react` / `chat.update` utility
blocks. Auto-streams flow output to the originating thread.

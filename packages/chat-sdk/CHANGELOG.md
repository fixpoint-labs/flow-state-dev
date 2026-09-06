# @flow-state-dev/chat-sdk

## 0.1.1

### Patch Changes

- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0

## 0.1.0

Initial release. `createChatTransportAdapter` wraps a Vercel `chat`
instance as an FSD inbound transport. Exposes `chatCapability` and the
`chat.post` / `chat.typing` / `chat.react` / `chat.update` utility
blocks. Auto-streams flow output to the originating thread.

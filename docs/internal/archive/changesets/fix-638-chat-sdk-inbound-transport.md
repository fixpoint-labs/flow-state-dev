---
"@flow-state-dev/chat-sdk": minor
---

FIX-638: New `@flow-state-dev/chat-sdk` package wrapping Vercel's Chat SDK as a multi-platform inbound transport. One adapter mounts every platform the host's `Chat` instance has registered (Slack, Microsoft Teams, Google Chat, Discord, plus other adapters). Inbound events drive FSD actions; flow output streams back to the originating thread by default. Exposes `chatCapability` for flow code that needs the live thread, plus `chat.post` / `chat.typing` / `chat.react` / `chat.update` utility blocks for explicit out-of-band sends.

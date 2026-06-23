---
"@flow-state-dev/react": patch
---

`useSession` now runs on the shared `@flow-state-dev/client` request-stream store and settles streamed message/reasoning content to its authoritative final value when a `content.done` event arrives (previously the final content only landed at item completion).

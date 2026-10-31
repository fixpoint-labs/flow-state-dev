---
"@flow-state-dev/workforce": patch
---

Add a `@flow-state-dev/workforce/browser` subpath that exports the roster keys, session helpers and message names (`SEND_MESSAGE_TOOL`, `MESSAGE_RECEIVED_ENTRY`, `RECEIVED_MESSAGE_COMPONENT`) without reaching any Node built-in, so client components can import them where the server-only package root would fail to compile (FIX-1605).

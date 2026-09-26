---
"@flow-state-dev/workforce": patch
---

Add a `@flow-state-dev/workforce/browser` subpath that exports the roster keys, `splitSeatAddress` and the channel post names without reaching any Node built-in, so client components can import them where the server-only package root would fail to compile (FIX-1605).

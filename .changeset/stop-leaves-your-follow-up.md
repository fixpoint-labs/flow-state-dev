---
"@flow-state-dev/workforce": patch
---

Pressing Stop and sending a follow-up straight away no longer stops the follow-up (FIX-2772).

- `WorkforceClient.send` sets each turn's request id itself and resolves to `{ requestId }` (it resolved to nothing before; `{ stream: true }` still resolves to the streamed `Response`).
- `WorkforceClient.stopTurns` stops each turn running when it reads them, each turn this client sent before the call among them, and leaves each turn this client sent after the call began.
- What Stop does not promise: it reads the running turns once, so a turn another client (another tab or device) starts after that read may run. Press Stop again to stop it.

Docs: packages/workforce/README.md (`send`'s answer; what `stopTurns` stops)

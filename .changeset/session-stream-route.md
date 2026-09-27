---
"@flow-state-dev/engine": patch
---

Add `GET /api/flows/sessions/:sessionId/stream`, which follows a whole session: each finished item any request in it keeps (filtered as the session snapshot filters), with its request id, and a notice naming the session's unfinished runs whenever that set changes. It is authorized as the snapshot is, reads the store about once a second (only what is unfinished or recently updated), and closes after at most 15 minutes. `@flow-state-dev/engine/testing` exports `createSessionStreamConformanceTests` for store adapters (FIX-1609).

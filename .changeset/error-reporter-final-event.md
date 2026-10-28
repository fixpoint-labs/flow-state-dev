---
"@flow-state-dev/engine": minor
---

`errorCapture` now also receives one `final: true` event, at `scope: "request"`, when a request settles failed: after rescues and retries, and only when its failed status was written. The per-block events are unchanged (FIX-1983).

---
"@flow-state-dev/server": patch
"@flow-state-dev/client": patch
"@flow-state-dev/devtool": patch
---

Fix DevTool requests that completed before a session view opened showing no inspectable items in the trace/stream tree.

`GET /sessions/:id/requests` now accepts an opt-in `include_items=true` query param that back-fills each summary's item log. The list endpoint still returns summaries only by default (the over-fetch removed in a prior release stays the default for production callers). The client `listSessionRequests` gains an `includeItems` option, and the DevTool sets it so historical requests render their full item tree on cold open — matching what a live-streamed request already shows.

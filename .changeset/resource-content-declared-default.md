---
"@flow-state-dev/engine": patch
---

`GET /sessions/:id/resources/:ref/content` now returns a single resource's declared content (`content` or `contentFile`) when nothing has written it yet, instead of `null`. A block reading the same resource already saw that body. A document loaded with `resourcesFromDocs` and marked `client: { content: { read: true } }` is now readable from a browser before any run writes it.

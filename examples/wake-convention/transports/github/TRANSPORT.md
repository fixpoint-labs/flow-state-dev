---
description: GitHub inbound webhook.
source: webhook
provider: github
---

Proposed registration. Today's host still names this adapter in code
(`createWebhookTransportAdapter({ providers: { github } })`). Putting
`TRANSPORT.md` here is the Layer-2 move: the folder registers the
transport, the host mounts whatever the walk found.

Events this transport produces live in `events/`.

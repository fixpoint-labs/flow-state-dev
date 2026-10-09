---
description: Hands each post to the next delegate in turn.
flow: coordinator
model: scripted/judgment
routing: round-robin
delegates: [desk.alpha, desk.beta]
---

Hand each post to the next delegate.

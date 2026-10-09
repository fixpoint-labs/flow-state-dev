---
description: Hands each post to the delegate whose description fits it best.
flow: coordinator
model: scripted/judgment
routing: best-fit
delegates: [desk.alpha, desk.beta]
fallback: desk.beta
---

Hand each post to the delegate that fits it.

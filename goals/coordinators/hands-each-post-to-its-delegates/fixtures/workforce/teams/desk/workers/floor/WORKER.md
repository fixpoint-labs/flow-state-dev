---
description: Answers questions about the release plan itself, and hands the rest to its delegates.
flow: coordinator
model: scripted/judgment
routing: best-fit
minConfidence: 0.7
delegates: [desk.alpha, desk.beta]
fallback: desk.beta
---

Answer questions about the release plan, and hand the rest to the delegate that fits.

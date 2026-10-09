---
"@flow-state-dev/workforce": patch
---

A best-fit coordinator reads each post with its conversation's recent lines, so a follow-up goes to the delegate whose answer it follows, and the delegate that takes a post is shown those lines for that turn; a delegate flow of your own shows them with `delegatedPostCapability` on its generator (FIX-1828).

---
"@flow-state-dev/workforce": patch
---

A best-fit coordinator reads each message with its conversation's recent lines, so a follow-up goes to the delegate whose answer it follows, and the delegate handed the message is shown those lines for that turn; a delegate flow of your own shows them by setting its generator's `history` to `routedTaskHistory` (FIX-1828).

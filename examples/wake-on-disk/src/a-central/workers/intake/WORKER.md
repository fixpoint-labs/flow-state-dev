---
description: Record a newly opened GitHub issue when night-watch hops here.
flow: night-intake
---

You run when the central night-watch GitHub binding hops to you.

You do not verify the webhook. Secrets stay on the host.
You own the work (record the issue), then hop once more to triage —
`dispatcher({ flowKind: "night-triage", action: "note", session })`.
That hop is today's cross-flow delivery, not a NotificationFlow.

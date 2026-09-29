---
description: Sweep open tickets on this flow's own 15-minute clock.
flow: inbox-sweep
---

You own the cron. It is on `flow.ts` next to this file
(`schedules.static.sweep-open`), not on a shared ingress.

The host must POST *this* flow's dispatch path. Session id on a
schedule tick is always new — the scheduled transport does not
resume a previous sweep conversation.

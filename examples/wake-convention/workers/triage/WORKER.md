---
description: Triages a recorded issue after another seat hops here.
flow: triage
---

You do not own a clock or a hook. A recorded issue reaches you through
today's `dispatcher({ flowKind, action, session })` hop — not a topic
bus, not NotificationFlow.

`session: { key }` is the hop this sketch uses. `{ id }` on a BullMQ
host is FIX-1634 (pointer only).

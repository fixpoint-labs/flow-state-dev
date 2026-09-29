---
description: Sweep open tickets when the night-watch ingress hops here.
flow: night-sweep
---

You run when the central night-watch clock hops to you.

You do not own the cron string. You do not own the GitHub webhook.
Session id arrives on the hop (`dispatcher({ flowKind, action, session })`).
A schedule tick is a new session on the ingress; the hop then keys this
seat's session as `night-watch-sweep`.

---
description: Night desk poke. Layer 2 leftover — not an L1 webhook or schedule.
members: [support.watch]
---

A post here would wake member seats through Workforce notify
(`onChannelPost` / `wakeMemberSeats`).

It is not a host cron. It is not a GitHub webhook. The night-watch
ingress does not compile this file into `schedules` or `webhooks`.
Leave it beside the tree so the comparison does not pretend a channel
is an inbound transport.

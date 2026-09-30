---
description: Night-watch the support inbox.
flow: inbox-watch
wakes:
  - id: sweep-open
    when: cron
    cron: "*/15 * * * *"
    timezone: UTC
    onOverlap: skip
    runs: sweep-open-tickets
  - id: github-issue-opened
    when: webhook
    provider: github
    event: issues
    action: opened
    session: issue
    runs: record-inbound-issue
  - id: desk-poke
    when: channel
    channel: support.desk
---

You sweep the support inbox on a timer and record newly opened GitHub issues.

This file is the worker-author view. Cron, webhook, and a channel poke sit in
one `wakes:` list so you do not hunt host mounts to learn *when* you run.

## When this fires

| id | When | What runs |
| --- | --- | --- |
| `sweep-open` | Host cron POSTs `schedules/sweep-open/dispatch` every 15 minutes (UTC). The cron string is display/validation — FSD does not tick. | `sweep-open-tickets`. New session each tick. |
| `github-issue-opened` | Verified GitHub `issues` delivery whose `action` is `opened`. | `record-inbound-issue`. Session is `repo#number`. |
| `desk-poke` | A post on Workforce channel `support.desk`. | **Does not compile to L1.** Channel notify is Layer 2 (`onChannelPost` / `wakeMemberSeats`). |

## What this file is not

- Not a Heartbeats product. `wakes:` is an authoring sketch.
- Not applied by `hireWorkforce` today. Extra frontmatter keys become flow
  *config*. Schedules and webhooks live on the *kind*. Leaving `wakes:` in
  `declared` and hiring a closed `configSchema` refuses the key by name.
- Not epic-wake / Lab Conductor tooling.

`src/worker-md/compile.ts` is the thin compile-to-existing-bindings path:
cron and webhook rows become `defineScheduleBinding` / `defineWebhookBinding`.
The channel row is returned as a leftover.

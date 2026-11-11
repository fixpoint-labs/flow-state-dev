# Plan — Inbound Transports & Reactive Flows

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

The order the epics run in, what each hands the next, and what is deliberately not next. Status is
[the epics table](SPEC.md#the-epics--derived-live-2026-11-11)'s; this page does not repeat it.

## The arc

One lane, closed. The arc becomes a figure once a second epic is filed and gives it an order to
show.

| Lane | Consumes | Releases |
|---|---|---|
| **webhook routing** · FIX-2471 · Nov 1 to Nov 11 | The webhook transport and its signature check, schedule rows, `sendMessage`'s exempt path, the coordinator's routing | A GitHub service flow, user-owned subscriptions with a screen chain, push or poll at 5 minutes or slower, `off` / `observe` / `auto` for unasked work, sessions publishing events, and routines over both triggers |

Before the lane, and before epics existed, the entry points shipped as loose issues: the adapter
contract and HTTP (FIX-438), webhooks (FIX-439), schedules (FIX-440), MCP (FIX-22), reactive
blocks (FIX-751) and session concurrency (FIX-837). Chat shipped too (FIX-638, FIX-667), and
FIX-1330 later removed it: platform events ride the webhook transport.

The next epic depends on one thing the wrap left open: **FIX-2694** measures the 5× token bar and
Slack-shaped events that the [kill line](SPEC.md#the-outcome) rests on.

## What is deliberately not next

- **A Slack or email service flow** (FIX-577). Not before FIX-2694 reports.
- **The inbound docs** (FIX-453). Written at release, not as an epic.
- **Chat as a core transport** (FIX-851, FIX-1306). FIX-1330 removed chat; these wait on a re-triage.
- **More MCP adapter shapes** (FIX-903, FIX-904, FIX-905). Weighed in the MCP project.
- **Outbound** (FIX-578). Outside the fence.

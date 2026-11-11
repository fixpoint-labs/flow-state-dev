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
contract and HTTP (FIX-438), webhooks (FIX-439), schedules (FIX-440), MCP (FIX-22), chat
(FIX-638, FIX-667), reactive blocks (FIX-751) and session concurrency (FIX-837).

## What the wrap hands the next epic

- **Prove the cost before more providers.** FIX-2694 measures the 5× token bar and Slack-shaped
  events. Until it reports, a Slack or email service flow builds on an unmeasured premise.
- **One routing decision, then the wiring.** FIX-2690 makes push and poll fetch only. FIX-2691
  names the schedule index once, and per the wrap analysis should also take the provider passed
  twice (to `hireWorkforce` and to `githubServiceFlow`) and `poll: true`, which does nothing until
  the installation polls.
- **Two correctness bugs.** FIX-2692 (a worker can't learn which custom screens a routine may
  take) and FIX-2693 (a delivery judged against settings the subscription no longer has).
- **Security, owned elsewhere.** FIX-2686 and FIX-2687 (High) sit under FIX-2689 in Framework
  simplification & cleanup.

## What is deliberately not next

- **A Slack or email service flow** (FIX-577). Not before FIX-2694 says routing pays.
- **The docs** (FIX-453). The outcome needs them, but they are written at release by
  `/release-docs`, not as an epic.
- **Chat as a core transport** (FIX-851, FIX-1306). A packaging call, not a new entry point.
- **More MCP adapter shapes** (FIX-903, FIX-904, FIX-905). Filed here; the MCP project's
  server-hardening epic is where they are weighed.
- **Outbound** (FIX-578). Filed here, outside the fence.
- **The persisted-schedule bug** (FIX-973). A loose bug, not an epic.

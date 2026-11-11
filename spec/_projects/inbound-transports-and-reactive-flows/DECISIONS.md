# Decisions — Inbound Transports & Reactive Flows

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind more than one epic under this project. A call one epic owns lives in that epic's
spec. No `PD` card yet: one epic is filed, so no call made here binds a second.

## Decided once

Settled before or by FIX-2471, and binding on any later epic that adds an entry point or a
provider, so none reopens them.

- **Every entry point is an `InboundTransportAdapter`, and the runtime below is the same for
  all.** Each adapter builds the request envelope (source, flow, action, input, session,
  principal, adapter metadata) and calls the same action path; the source is recorded on the
  request. Decided in FIX-438 before this project-spec existed, and shipped for HTTP, webhooks,
  schedules, MCP and chat. A new transport is an adapter, never a runtime change.
- **Code routes an outside event; no model reads every event to decide who hears it.** One
  service flow per provider looks up who subscribed. A model is used at most once per event, as
  the one evaluator screen, and never a generator
  ([FIX-2471 D1, D2](../../../specs/epics/FIX-2471/DECISIONS.md#d1)). This one carries the
  [kill line](SPEC.md#the-outcome): FIX-2694 measures whether it pays.
- **A subscription is its user's, and a user hears only threads they can read.** It runs on that
  user's credentials and is checked at subscribe; nothing crosses users
  ([D5](../../../specs/epics/FIX-2471/DECISIONS.md#d5)). An outsider's content is screened out by
  default ([Q1](../../../specs/epics/FIX-2471/DECISIONS.md#q1)).
- **Delivery is `sendMessage`'s exempt path.** One messaging API, no new sender kind and no roster
  worker ([D9](../../../specs/epics/FIX-2471/DECISIONS.md#d9)). A Slack, email or chat provider
  delivers the same way.
- **Push and poll only fetch.** One decision about who hears an event, made once after either
  ingestion path ([D4](../../../specs/epics/FIX-2471/DECISIONS.md#d4)). The code still decides it
  twice; FIX-2690 makes it once, and the wrap's prior-art pass (Zapier's poll-as-fetcher) backs
  that shape. A new provider adds a fetcher, not a third decision.
- **`sessionId` routing stays where no service flow routes.** GitHub routes by subscription;
  Stripe, Slack and custom bindings keep naming a session. Two ways to route, split by provider,
  on purpose ([Q5](../../../specs/epics/FIX-2471/DECISIONS.md#q5)). A provider loses `sessionId`
  only when it gets a service flow.
- **A routine is one standing instruction with one trigger, a clock or an event.** One name, one
  list and one tool set over the schedule rows and the subscription rows, with no new store
  ([D12](../../../specs/epics/FIX-2471/DECISIONS.md#d12)). Anything new that fires on its own is
  a routine, not a third list.

## Open

None at project altitude. The kill line's measurement is FIX-2694's, and it becomes an ask here
only if it comes in under 5×.

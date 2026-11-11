# Decisions — Inbound Transports & Reactive Flows

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind more than one epic under this project. A call one epic owns lives in that epic's
spec. No `PD` card yet: one epic is filed, so no call made here binds a second.

## Decided once

- **Every entry point is an `InboundTransportAdapter`, and the runtime below is the same for
  all.** Each adapter builds the request envelope (source, flow, action, input, session,
  principal, adapter metadata) and calls the same action path; the source is recorded on the
  request. Decided in FIX-438 before this project-spec existed, and shipped for HTTP, webhooks,
  schedules and MCP. A new transport is an adapter, never a runtime change, so a second
  transport or provider epic inherits this rather than making it again.

How an outside event is routed, screened and delivered, and what a routine is, are canonical in
[FIX-2471's decisions](../../../specs/epics/FIX-2471/DECISIONS.md). A later epic reads them there;
they move here only when a second epic is filed and one of them binds it.

## Open

None at project altitude. The kill line's measurement is FIX-2694's, and it becomes an ask here
only if it comes in under 5×.

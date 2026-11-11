<!-- Verbatim snapshot. Do not edit, reflow, or fold. -->

# Linear project `content`, as read

**Read** 2026-11-11 from the Linear project
[Inbound Transports & Reactive Flows](https://linear.app/fixpoint-labs/project/inbound-transports-and-reactive-flows-42c513dcfe7c)
· project `updatedAt` **2026-08-24T15:40:03.674Z** · description: "Flows runnable from any source"

Everything below the rule is the field exactly as the API returned it, before the project-spec
replaced it. What was folded and what was left behind is in the project PR's first report.

---

## Objective

Establish a single coherent inbound entry-point story for FSD: every way of driving a flow from outside the runtime (HTTP, MCP, webhooks, schedules, cross-flow events) lands as an implementation of the same `InboundTransportAdapter` contract. The runtime below the adapter is identical regardless of source.

This is the launch-defining work for Wave 1's "flows runnable from any source" story. Companion epic to [FIX-442](https://linear.app/fixpoint-labs/issue/FIX-442/plan-task-unified-work-unit-primitive-epic) (Plan/Task). Together these two epics carry the leading narrative for the Wave 1 launch:

* Plan/Task — every multi-agent pattern is the same primitive
* Inbound Transports — every entry point is the same primitive

## Background

Today the framework has exactly one inbound entry point (`createFlowApiRouter`) and it hardcodes the assumption that requests originate from a logged-in browser user over HTTP. Webhooks, schedules, MCP, and cross-flow events have no architectural home — each was a one-off until [FIX-438](https://linear.app/fixpoint-labs/issue/FIX-438/inbound-transport-adapter-abstraction-parent-design) proposed the unifying contract.

This epic delivers [FIX-438](https://linear.app/fixpoint-labs/issue/FIX-438/inbound-transport-adapter-abstraction-parent-design) plus all four siblings ([FIX-439](https://linear.app/fixpoint-labs/issue/FIX-439/webhook-receivers-declarative-inbound-webhook-handling) webhooks, [FIX-440](https://linear.app/fixpoint-labs/issue/FIX-440/scheduled-actions-declarative-cron-dispatch-endpoint) schedules, [FIX-441](https://linear.app/fixpoint-labs/issue/FIX-441/cross-flow-event-bus-notifytopic-notificationflow-subscribers-subset) cross-flow events, [FIX-22](https://linear.app/fixpoint-labs/issue/FIX-22/mcp-server-integration-expose-flows-as-mcp-servers) MCP) under one Wave 1 push.

## Pitch line

*Flows in FSD are runnable from any source — HTTP, webhooks, schedules, MCP servers, agent-to-agent events — and the runtime below is identical. Same scopes, same observability, same DevTool, same retry semantics. Add a transport, and every existing flow gains a new way of being invoked.*

This is the line that flips FSD from "AI agent framework you call" to "autonomous agent runtime that runs." Closest analog to what made OpenClaw lit, expressed as composable primitives.

## Architectural foundation

Every transport implements `InboundTransportAdapter` ([FIX-438](https://linear.app/fixpoint-labs/issue/FIX-438/inbound-transport-adapter-abstraction-parent-design)):

```ts
interface InboundTransportAdapter {
  readonly source: string;  // 'http' | 'mcp' | 'webhook' | 'scheduled' | 'notification'
  mount(opts: { registry, runtime }): TransportBindings;
}
```

Every adapter constructs an `InboundRequestEnvelope` before invoking `runAction`, carrying:

* `source` (provenance metadata, surfaces in DevTool and on `RequestRecord`)
* `flowKind`, `action`, `input`
* `sessionId` (existing or new)
* `principal` (resolved via the auth hook from [FIX-23](https://linear.app/fixpoint-labs/issue/FIX-23/authentication-strategy-principal-resolver-and-auth-hooks))
* adapter-specific `metadata` (webhook headers, schedule name, MCP session, etc.)

The runtime treats all envelopes identically. Adapters are independently composable — a webhook can publish to a topic that a notification flow subscribes to, a scheduled tick can dispatch to the same `runAction` path as an HTTP user request, MCP tool calls feed the same flow that powers the chat UI.

## Mirror to [FIX-380](https://linear.app/fixpoint-labs/issue/FIX-380/spike-ably-ai-transport-integration-as-pluggable-websocket-transport)

This epic is the architectural symmetric pair to [FIX-380](https://linear.app/fixpoint-labs/issue/FIX-380/spike-ably-ai-transport-integration-as-pluggable-websocket-transport)'s outbound transport adapter (Ably AI Transport). [FIX-380](https://linear.app/fixpoint-labs/issue/FIX-380/spike-ably-ai-transport-integration-as-pluggable-websocket-transport) abstracts how stream events leave the runtime; this epic abstracts how invocations enter the runtime. Together they give the framework a clean transport boundary on both sides — also a launch-narrative element worth surfacing in the marketing site.

## Sub-task structure

1. [FIX-438](https://linear.app/fixpoint-labs/issue/FIX-438/inbound-transport-adapter-abstraction-parent-design) **— Inbound transport adapter contract + HTTP refactor** (foundation; Wave 1)
2. [FIX-441](https://linear.app/fixpoint-labs/issue/FIX-441/cross-flow-event-bus-notifytopic-notificationflow-subscribers-subset) **— Cross-flow event bus** (parallel; promote to Wave 1)
3. [FIX-439](https://linear.app/fixpoint-labs/issue/FIX-439/webhook-receivers-declarative-inbound-webhook-handling) **— Webhook receivers** (Wave 1; depends on 438)
4. [FIX-440](https://linear.app/fixpoint-labs/issue/FIX-440/scheduled-actions-declarative-cron-dispatch-endpoint) **— Scheduled actions** (Wave 1; depends on 438)
5. [FIX-22](https://linear.app/fixpoint-labs/issue/FIX-22/mcp-server-integration-expose-flows-as-mcp-servers) **— MCP server integration** (Wave 1; depends on 438)
6. **NEW Docs** — architecture page covering the unified inbound transport story + per-transport integration guides

## Wave assignment changes

This epic moves several issues into Wave 1 from elsewhere:

* [FIX-441](https://linear.app/fixpoint-labs/issue/FIX-441/cross-flow-event-bus-notifytopic-notificationflow-subscribers-subset) — was unmilestoned (carved from [FIX-149](https://linear.app/fixpoint-labs/issue/FIX-149/advanced-patterns-pubsub-generated-sequences-deterministic-replay-and) Wave 4); promote to Wave 1
* [FIX-439](https://linear.app/fixpoint-labs/issue/FIX-439/webhook-receivers-declarative-inbound-webhook-handling) — currently Wave 2; promote to Wave 1
* [FIX-440](https://linear.app/fixpoint-labs/issue/FIX-440/scheduled-actions-declarative-cron-dispatch-endpoint) — currently Wave 2; promote to Wave 1
* [FIX-22](https://linear.app/fixpoint-labs/issue/FIX-22/mcp-server-integration-expose-flows-as-mcp-servers) — currently Wave 2 (with explicit "may be pulled forward" note); promote to Wave 1

The companion auth hook ([FIX-23](https://linear.app/fixpoint-labs/issue/FIX-23/authentication-strategy-principal-resolver-and-auth-hooks)) is a soft dependency — the transport adapters can ship with a stub principal resolver if [FIX-23](https://linear.app/fixpoint-labs/issue/FIX-23/authentication-strategy-principal-resolver-and-auth-hooks) doesn't land in time, with the production resolver wired in as a follow-up.

## Why all of this in Wave 1

Once external apps build on FSD, breaking changes to entry-point shapes (URLs, envelope shapes, auth flows) hurt every consumer. Locking the inbound abstraction before launch is correct, and the launch story only sells if it lands cohesively — webhooks alone is incremental, all five transports together is a category move.

Plus: each transport individually is moderate scope, and the `InboundTransportAdapter` contract is the load-bearing piece. Once it lands, the four implementations can fan out concurrently.

## Composition stories worth keeping in mind

These are the cross-transport demos that earn the epic its weight:

1. **Webhook → event bus → multiple subscribers.** Stripe webhook publishes to `stripe.events`; an audit flow and a billing flow both subscribe and react independently. Receiver doesn't know which flows care.
2. **Scheduled watchful-loop.** A flow registers a per-session schedule; on each tick, the agent evaluates state and decides whether to speak (act) or stay silent (no message item emitted). The OpenClaw HEARTBEAT_OK shape, expressed as composition.
3. **MCP exposure of an existing flow.** A flow built for the kitchen-sink chat UI is reachable from Claude Desktop with one config flag. Same scopes, same actions, same data — different transport.
4. **Cross-transport handoff.** A user starts a workflow via HTTP, a Stripe webhook lands a payment confirmation later, the same session resumes and continues. Tier 1 of the long-running webhook story ([FIX-439](https://linear.app/fixpoint-labs/issue/FIX-439/webhook-receivers-declarative-inbound-webhook-handling)); the durable-suspend version ([FIX-141](https://linear.app/fixpoint-labs/issue/FIX-141/durable-execution-durabilityprovider-checkpoint-management) / [FIX-140](https://linear.app/fixpoint-labs/issue/FIX-140/design-durable-execution-model-durabilityprovider-abstraction-vs)) is Wave 3.

These should be exercised by the Demo Apps epic (separate, in flight).

## Acceptance criteria for the epic

* All five transports implement the same `InboundTransportAdapter` contract
* Adding a new transport requires no changes to the runtime, store, or auth code beyond the auth hook implementation
* Every `RequestRecord` carries the originating `source`, surfaced in DevTool
* The four composition stories above can be implemented by a developer following the docs without contacting the framework team
* Architecture docs cover the unified transport story plus per-transport integration guides

## Out of scope

* Outbound transport adapter ([FIX-380](https://linear.app/fixpoint-labs/issue/FIX-380/spike-ably-ai-transport-integration-as-pluggable-websocket-transport)) — companion epic, separate
* Long-running flows that suspend on a webhook callback — Wave 3 ([FIX-141](https://linear.app/fixpoint-labs/issue/FIX-141/durable-execution-durabilityprovider-checkpoint-management) / [FIX-140](https://linear.app/fixpoint-labs/issue/FIX-140/design-durable-execution-model-durabilityprovider-abstraction-vs))
* Flows *consuming* external MCP servers — [FIX-187](https://linear.app/fixpoint-labs/issue/FIX-187/mcp-server-consumption-research-design) and its children
* Skill triggering via inbound events — composition use case, not a new transport (skills can subscribe to bus topics via NotificationFlows once [FIX-441](https://linear.app/fixpoint-labs/issue/FIX-441/cross-flow-event-bus-notifytopic-notificationflow-subscribers-subset) lands)